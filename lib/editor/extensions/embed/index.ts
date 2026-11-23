import { $createLinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import {
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	PASTE_COMMAND,
	type NodeKey,
} from "lexical";

import type { BlockItem, EditorExtension } from "../../core/extension.ts";
import { $insertBlocks, $lineAfter, $selectedBlockKey } from "../../shared/blocks.ts";
import { registerClickSelect } from "../../shared/click-select.ts";
import { listen, onPointerOutside } from "../../shared/dom.ts";
import { $createEmbedNode, $isEmbedNode, EmbedNode, type EmbedMode } from "./node.ts";
import { createPasteMenuStore, pasteOptions } from "./paste-menu/state.ts";
import { createPasteMenuView } from "./paste-menu/view.ts";
import { setPreviewFetcher, type PreviewFetcher } from "./preview.ts";
import { parseLink } from "./providers.ts";

export { $createEmbedNode, $isEmbedNode, EmbedNode, type EmbedMode } from "./node.ts";
export { type LinkPreview, type PreviewFetcher } from "./preview.ts";
export { embedFor, isEmbeddable, parseLink } from "./providers.ts";

/** Inserts an embed (or bookmark) block at the cursor, asking for its link. */
export const INSERT_EMBED_COMMAND = createCommand<EmbedMode>("INSERT_EMBED_COMMAND");

const item = (
	id: string,
	label: string,
	hint: string,
	keywords: string,
	order: number,
	mode: EmbedMode,
): BlockItem => ({
	id,
	label,
	hint,
	keywords,
	order,
	hiddenIn: ["table"],
	apply: (e) => e.dispatchCommand(INSERT_EMBED_COMMAND, mode),
});

/** Turns the pasted link's line into an embed or bookmark. */
function $replaceLine(paragraphKey: NodeKey, url: string, mode: EmbedMode): void {
	const paragraph = $getNodeByKey(paragraphKey);
	if (!$isParagraphNode(paragraph) || paragraph.getTextContent().trim() !== url) return;
	const node = $createEmbedNode(url, mode);
	paragraph.replace(node);
	$lineAfter(node).selectStart();
}

/**
 * Embeds and bookmarks: `/embed`, `/video`, `/bookmark`, and a "Paste as"
 * menu (Embed / Bookmark / Keep as link) after pasting a lone link on an
 * empty line. `fetchPreview` gives bookmarks their title and image.
 */
export function embedExtension({
	fetchPreview,
}: { fetchPreview?: PreviewFetcher } = {}): EditorExtension {
	return {
		name: "embed",
		nodes: [EmbedNode],
		items: [
			item(
				"embed",
				"Embed",
				"YouTube, Figma, Google Maps, any page…",
				"embed iframe video youtube vimeo loom figma maps spotify codepen sandbox google docs sheets slides drive miro",
				180,
				"embed",
			),
			item(
				"video",
				"Video link",
				"Embed from YouTube, Vimeo or Loom",
				"video youtube vimeo loom movie clip",
				190,
				"embed",
			),
			item(
				"bookmark",
				"Web bookmark",
				"A link as a visual card",
				"bookmark link card preview web url",
				200,
				"bookmark",
			),
		],
		register({ editor, host }) {
			setPreviewFetcher(fetchPreview ?? null);
			const store = createPasteMenuStore();
			const hide = () => store.set({ pasted: null });
			const choose = (index: number) => {
				const { pasted, options } = store.get();
				const mode = options[index]?.mode;
				hide();
				if (pasted && mode) editor.update(() => $replaceLine(pasted.paragraph, pasted.url, mode));
			};
			const view = createPasteMenuView({
				onChoose: choose,
				fallbackRect: () => {
					const key = store.get().pasted?.paragraph;
					return (key && editor.getElementByKey(key)?.getBoundingClientRect()) || null;
				},
			});
			const offRender = store.subscribe((state, prev) => view.render(state, prev));
			const open = () => store.get().pasted !== null && !view.element.hidden;

			// The menu answers keys while it's open; anything else closes it.
			const onKey = (event: KeyboardEvent) => {
				if (!open()) return;
				const { options, active } = store.get();
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					event.stopPropagation();
					const step = event.key === "ArrowDown" ? 1 : options.length - 1;
					store.set({ active: (active + step) % options.length });
				} else if (event.key === "Enter") {
					event.preventDefault();
					event.stopPropagation();
					choose(active);
				} else if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					hide();
				} else if (!["Shift", "Meta", "Control", "Alt"].includes(event.key)) hide();
			};

			return mergeRegister(
				editor.registerCommand(
					INSERT_EMBED_COMMAND,
					(mode) => {
						$insertBlocks([$createEmbedNode("", mode)], $selectedBlockKey());
						return true;
					},
					COMMAND_PRIORITY_EDITOR,
				),
				// A lone link pasted on an empty top-level line: insert it as a link, then offer the menu.
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
						const data = event.clipboardData;
						if (data.files.length > 0 || data.types.includes("application/x-lexical-editor"))
							return false;
						const text = data.getData("text/plain").trim();
						if (!/^https?:\/\/\S+$/i.test(text)) return false;
						const url = parseLink(text);
						const selection = $getSelection();
						if (!url || !$isRangeSelection(selection) || !selection.isCollapsed()) return false;
						const block = selection.anchor.getNode().getTopLevelElement();
						if (
							!$isParagraphNode(block) ||
							block.getTextContentSize() > 0 ||
							block.getParent() === null
						)
							return false;
						event.preventDefault();
						const link = $createLinkNode(url.href);
						link.append($createTextNode(url.href));
						block.append(link);
						link.selectEnd();
						const paragraph = block.getKey();
						requestAnimationFrame(() =>
							store.set({ pasted: { paragraph, url: url.href }, ...pasteOptions(url) }),
						);
						return true;
					},
					COMMAND_PRIORITY_CRITICAL,
				),
				registerClickSelect(editor, host, ".ne-embed:not(.is-empty)", $isEmbedNode),
				listen(document, "keydown", onKey, true),
				onPointerOutside(
					() => [view.element],
					() => open() && hide(),
				),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
