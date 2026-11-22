import { $toggleLink, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { LINK } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";
import {
	$getSelection,
	$isRangeSelection,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	createCommand,
	KEY_DOWN_COMMAND,
	PASTE_COMMAND,
	type RangeSelection,
} from "lexical";

import { ranked, type EditorExtension } from "../../core/extension.ts";
import { caretRect, listen, onPointerOutside } from "../../shared/dom.ts";
import {
	$linkAtSelection,
	$linkOfElement,
	$selectLinkTarget,
	normalizeUrl,
	URL_LIKE,
} from "./logic.ts";
import { createLinkUIStore } from "./state.ts";
import { createLinkUIView } from "./view.ts";

export { normalizeUrl } from "./logic.ts";

/** Opens the URL editor over the current selection (toolbar button, ⌘K). */
export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND");

/**
 * Web links: the TOGGLE_LINK command, ⌘K and paste-a-URL-on-a-selection, a
 * hover card (Open / Edit / Unlink), an edit popover, and plain click opening
 * the link in a new tab.
 */
export function linkExtension(): EditorExtension {
	return {
		name: "link",
		nodes: [LinkNode],
		markdown: ranked(10, LINK),
		toolbar: [
			{
				id: "link",
				icon: "link",
				label: "Link",
				title: "Link (⌘K)",
				className: "fmt-link",
				order: 60,
				run: (editor) => editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined),
				isActive: () => $linkAtSelection() !== null,
			},
		],
		register({ editor }) {
			const store = createLinkUIStore();
			/** The editor selection to re-apply when the popover commits. */
			let saved: RangeSelection | null = null;

			const closePopover = (refocus: boolean) => {
				if (!store.get().editing) return;
				store.set({ editing: null });
				saved = null;
				if (refocus) editor.focus();
			};
			const openPopover = (rect: DOMRect, url: string) => {
				hideCard();
				store.set({ editing: { rect, url } });
			};

			let showTimer = 0;
			let hideTimer = 0;
			const hideCard = () => {
				clearTimeout(showTimer);
				clearTimeout(hideTimer);
				store.set({ card: null });
			};

			const view = createLinkUIView({
				onCommit: (value) => {
					const url = normalizeUrl(value);
					const selection = saved;
					closePopover(true);
					if (!selection) return;
					editor.update(() => {
						$setSelection(selection.clone());
						$toggleLink(url);
					});
				},
				onCancel: () => closePopover(true),
				onEdit: () => {
					const anchor = store.get().card;
					hideCard();
					if (!anchor) return;
					let url = "";
					editor.update(() => {
						const link = $linkOfElement(anchor);
						const target = link ? $selectLinkTarget(link) : null;
						saved = target?.selection ?? null;
						url = target?.url ?? "";
					});
					if (saved) openPopover(anchor.getBoundingClientRect(), url);
				},
				onUnlink: () => {
					const anchor = store.get().card;
					hideCard();
					if (!anchor) return;
					editor.update(() => {
						const link = $linkOfElement(anchor);
						if (!link) return;
						link.select(0, link.getChildrenSize());
						$toggleLink(null);
					});
				},
			});
			const offRender = store.subscribe((state, prev) => view.render(state, prev));

			/**
			 * Opens the popover for the current selection, expanding to the whole link if
			 * inside one. Runs inside a command listener, so it is already in an update;
			 * opening waits until the update has committed (focusing the input mid-update
			 * would fight Lexical's selection reconciliation).
			 */
			const editSelection = () => {
				const target = $selectLinkTarget();
				if (!target) return false;
				saved = target.selection;
				const rect = caretRect();
				if (!rect) return false;
				setTimeout(() => openPopover(rect, target.url), 0);
				return true;
			};

			const linkAt = (target: EventTarget | null) => {
				const anchor = (target as Element | null)?.closest<HTMLAnchorElement>("a.ne-link");
				return anchor && editor.getRootElement()?.contains(anchor) ? anchor : null;
			};

			const onOver = (event: MouseEvent) => {
				const anchor = linkAt(event.target);
				const { card } = store.get();
				if (anchor) {
					clearTimeout(hideTimer);
					if (card === anchor) return;
					clearTimeout(showTimer);
					showTimer = window.setTimeout(() => store.set({ card: anchor }), 250);
				} else if (view.card.contains(event.target as Node)) {
					clearTimeout(hideTimer);
				} else {
					clearTimeout(showTimer);
					if (card) hideTimer = window.setTimeout(hideCard, 250);
				}
			};

			// Plain click on a link opens it (like Notion); drag-selections don't.
			const onClick = (event: MouseEvent) => {
				const anchor = linkAt(event.target);
				if (!anchor || event.defaultPrevented) return;
				event.preventDefault();
				if (getSelection()?.isCollapsed === false) return;
				window.open(anchor.href, "_blank", "noreferrer");
			};

			return mergeRegister(
				editor.registerCommand(
					TOGGLE_LINK_COMMAND,
					(payload) => {
						if (payload === null || typeof payload === "string") $toggleLink(payload);
						else $toggleLink(payload.url, payload);
						return true;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(OPEN_LINK_EDITOR_COMMAND, editSelection, COMMAND_PRIORITY_LOW),
				editor.registerCommand(
					KEY_DOWN_COMMAND,
					(event) => {
						if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return false;
						event.preventDefault();
						return editSelection();
					},
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						if (!(event instanceof ClipboardEvent)) return false;
						const text = event.clipboardData?.getData("text/plain") ?? "";
						const url = normalizeUrl(text);
						if (!url || !URL_LIKE.test(text.trim())) return false;
						const linked = editor.getEditorState().read(() => {
							const selection = $getSelection();
							return $isRangeSelection(selection) && !selection.isCollapsed();
						});
						if (!linked) return false;
						event.preventDefault();
						editor.update(() => $toggleLink(url));
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				// Mutations can remove a hovered link out from under the card.
				editor.registerMutationListener(LinkNode, () => {
					const { card } = store.get();
					if (card && !card.isConnected) hideCard();
				}),
				listen(document, "mouseover", onOver),
				listen(document, "click", onClick),
				onPointerOutside(
					() => [view.popover],
					() => closePopover(false),
				),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
