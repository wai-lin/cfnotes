import { $isLinkNode, $toggleLink, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { icon } from "@modules/icons";
import {
	$getNearestNodeFromDOMNode,
	$getSelection,
	$isRangeSelection,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	createCommand,
	KEY_DOWN_COMMAND,
	PASTE_COMMAND,
	type LexicalEditor,
	type RangeSelection,
} from "lexical";

/** Opens the URL editor over the current selection (toolbar button, ⌘K). */
export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>("OPEN_LINK_EDITOR_COMMAND");

const URL_LIKE = /^(https?:\/\/|mailto:|tel:)\S+$/i;
const BARE_URL = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;

function normalize(raw: string): string | null {
	const url = raw.trim();
	if (!url) return null;
	if (URL_LIKE.test(url)) return url;
	if (BARE_URL.test(url)) return `https://${url}`;
	return null;
}

/**
 * Everything web links need in a vanilla Lexical editor: the TOGGLE_LINK command,
 * ⌘K and paste-a-URL-on-a-selection, a hover card (Open / Edit / Unlink), an edit
 * popover, and plain click opening the link in a new tab.
 */
export function registerLinkUI(editor: LexicalEditor): () => void {
	// ---- edit popover ----
	const pop = document.createElement("div");
	pop.className = "link-pop";
	pop.hidden = true;
	const input = document.createElement("input");
	input.className = "link-input";
	input.type = "text";
	input.placeholder = "Paste a link…";
	input.setAttribute("aria-label", "Link URL");
	pop.append(input);
	document.body.append(pop);

	/** The editor selection to re-apply when the popover commits. */
	let saved: RangeSelection | null = null;

	const closePop = (refocus: boolean) => {
		if (pop.hidden) return;
		pop.hidden = true;
		saved = null;
		if (refocus) editor.focus();
	};

	const placeAt = (rect: DOMRect, el: HTMLElement) => {
		const top = rect.bottom + 6;
		el.style.top = `${top + el.offsetHeight < innerHeight ? top : Math.max(8, rect.top - el.offsetHeight - 6)}px`;
		el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - el.offsetWidth - 8))}px`;
	};

	const openPop = (rect: DOMRect, current: string) => {
		hideCard();
		input.value = current;
		pop.hidden = false;
		placeAt(rect, pop);
		input.focus();
		input.select();
	};

	/**
	 * Opens the popover for the current selection, expanding to the whole link if
	 * inside one. Runs inside a command listener, so it is already in an update:
	 * `$`-functions work directly, and opening waits until the update has committed
	 * (focusing the input mid-update would fight Lexical's selection reconciliation).
	 */
	const editSelection = () => {
		const selection = $getSelection();
		if (!$isRangeSelection(selection)) return false;
		let current = "";
		const link = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
		if (link) {
			current = link.getURL();
			link.select(0, link.getChildrenSize());
		} else if (selection.isCollapsed()) {
			return false; // nothing to link
		}
		const live = $getSelection();
		if (!$isRangeSelection(live)) return false;
		saved = live.clone();
		const native = window.getSelection();
		const rect =
			native && native.rangeCount > 0 ? native.getRangeAt(0).getBoundingClientRect() : null;
		if (!rect) return false;
		setTimeout(() => openPop(rect, current), 0);
		return true;
	};

	const commit = () => {
		const url = normalize(input.value);
		const selection = saved;
		closePop(true);
		if (!selection) return;
		editor.update(() => {
			$setSelection(selection.clone());
			$toggleLink(url);
		});
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			closePop(true);
		}
	});

	// ---- hover card ----
	const card = document.createElement("div");
	card.className = "link-card";
	card.hidden = true;
	const href = document.createElement("a");
	href.className = "link-card-url";
	href.target = "_blank";
	href.rel = "noreferrer noopener";
	const editButton = document.createElement("button");
	editButton.type = "button";
	editButton.className = "link-card-btn";
	editButton.textContent = "Edit";
	const unlinkButton = document.createElement("button");
	unlinkButton.type = "button";
	unlinkButton.className = "link-card-btn";
	unlinkButton.innerHTML = icon("x", 14);
	unlinkButton.title = "Remove link";
	unlinkButton.setAttribute("aria-label", "Remove link");
	card.append(href, editButton, unlinkButton);
	document.body.append(card);

	let cardFor: HTMLElement | null = null;
	let showTimer = 0;
	let hideTimer = 0;

	const hideCard = () => {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		card.hidden = true;
		cardFor = null;
	};

	const showCard = (anchor: HTMLAnchorElement) => {
		cardFor = anchor;
		href.textContent = anchor.href.replace(/^https?:\/\//, "").replace(/\/$/, "");
		href.href = anchor.href;
		card.hidden = false;
		placeAt(anchor.getBoundingClientRect(), card);
	};

	/** The link node a card or click points at, selected whole. */
	const selectWholeLink = (anchor: HTMLElement) => {
		const node = $getNearestNodeFromDOMNode(anchor);
		const link = node ? ($isLinkNode(node) ? node : $findMatchingParent(node, $isLinkNode)) : null;
		if (link) link.select(0, link.getChildrenSize());
		return link !== null;
	};

	editButton.addEventListener("click", () => {
		const anchor = cardFor;
		hideCard();
		if (!anchor) return;
		let current = "";
		editor.update(() => {
			const node = $getNearestNodeFromDOMNode(anchor);
			const link = node
				? $isLinkNode(node)
					? node
					: $findMatchingParent(node, $isLinkNode)
				: null;
			if (!link) return;
			current = link.getURL();
			link.select(0, link.getChildrenSize());
			const live = $getSelection();
			saved = $isRangeSelection(live) ? live.clone() : null;
		});
		if (saved) openPop(anchor.getBoundingClientRect(), current);
	});

	unlinkButton.addEventListener("click", () => {
		const anchor = cardFor;
		hideCard();
		if (!anchor) return;
		editor.update(() => {
			if (selectWholeLink(anchor)) $toggleLink(null);
		});
	});

	const linkAt = (target: EventTarget | null) => {
		const anchor = (target as Element | null)?.closest<HTMLAnchorElement>("a.ne-link");
		return anchor && editor.getRootElement()?.contains(anchor) ? anchor : null;
	};

	const onOver = (event: MouseEvent) => {
		const anchor = linkAt(event.target);
		if (anchor) {
			clearTimeout(hideTimer);
			if (cardFor === anchor) return;
			clearTimeout(showTimer);
			showTimer = window.setTimeout(() => showCard(anchor), 250);
		} else if (card.contains(event.target as Node)) {
			clearTimeout(hideTimer);
		} else {
			clearTimeout(showTimer);
			if (!card.hidden) hideTimer = window.setTimeout(hideCard, 250);
		}
	};
	document.addEventListener("mouseover", onOver);

	// Plain click on a link opens it (like Notion); drag-selections don't.
	const onClick = (event: MouseEvent) => {
		const anchor = linkAt(event.target);
		if (!anchor || event.defaultPrevented) return;
		event.preventDefault();
		if (window.getSelection()?.isCollapsed === false) return;
		window.open(anchor.href, "_blank", "noreferrer");
	};

	const onOutside = (event: PointerEvent) => {
		if (!pop.hidden && !pop.contains(event.target as Node)) closePop(false);
	};
	document.addEventListener("click", onClick);
	document.addEventListener("pointerdown", onOutside, true);

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
				const url = normalize(text);
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
			if (cardFor && !cardFor.isConnected) hideCard();
		}),
		() => {
			document.removeEventListener("mouseover", onOver);
			document.removeEventListener("click", onClick);
			document.removeEventListener("pointerdown", onOutside, true);
			pop.remove();
			card.remove();
		},
	);
}
