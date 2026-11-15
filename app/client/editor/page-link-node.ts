import { $isCodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import { icon } from "@modules/icons";
import { PAGE_LINK_TYPE } from "@modules/links";
import {
	$createTextNode,
	$getAdjacentNode,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_LOW,
	COMMAND_PRIORITY_NORMAL,
	DecoratorNode,
	KEY_ARROW_LEFT_COMMAND,
	KEY_ARROW_RIGHT_COMMAND,
	PASTE_COMMAND,
	type DOMConversionMap,
	type DOMExportOutput,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { currentPageId, onPagesChange, titleOf } from "./page-directory";

export type SerializedPageLinkNode = Spread<{ pageId: string }, SerializedLexicalNode>;

/** Draws a link's contents from the page's current title (or a "deleted" state). */
function paint(dom: HTMLElement, pageId: string) {
	const title = titleOf(pageId);
	dom.classList.toggle("is-missing", title === null);
	dom.innerHTML =
		title === null
			? `<span class="ne-page-link-a">${icon("fileOff")}<span class="ne-page-link-title"></span></span>`
			: `<a class="ne-page-link-a" href="/p/${pageId}">${icon("fileText")}<span class="ne-page-link-title"></span></a>`;
	dom.querySelector(".ne-page-link-title")!.textContent = title ?? "Deleted page";
}

/**
 * An inline link to another page. It stores only the page id; the title shown
 * is looked up live, so renaming a page renames every link to it.
 */
export class PageLinkNode extends DecoratorNode<null> {
	__pageId: string;

	static override getType(): string {
		return PAGE_LINK_TYPE;
	}

	static override clone(node: PageLinkNode): PageLinkNode {
		return new PageLinkNode(node.__pageId, node.__key);
	}

	static override importJSON(json: SerializedPageLinkNode): PageLinkNode {
		return $createPageLinkNode(json.pageId).updateFromJSON(json);
	}

	static override importDOM(): DOMConversionMap {
		return {
			a: (element: HTMLElement) => {
				const pageId = element.getAttribute("data-page-link");
				if (!pageId) return null;
				return { conversion: () => ({ node: $createPageLinkNode(pageId) }), priority: 2 };
			},
		};
	}

	constructor(pageId: string, key?: NodeKey) {
		super(key);
		this.__pageId = pageId;
	}

	getPageId(): string {
		return this.__pageId;
	}

	override exportJSON(): SerializedPageLinkNode {
		return { ...super.exportJSON(), pageId: this.__pageId };
	}

	override exportDOM(): DOMExportOutput {
		const a = document.createElement("a");
		a.href = `/p/${this.__pageId}`;
		a.setAttribute("data-page-link", this.__pageId);
		a.textContent = this.getTextContent();
		return { element: a };
	}

	override createDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "ne-page-link";
		span.contentEditable = "false";
		span.dataset.pageId = this.__pageId;
		paint(span, this.__pageId);
		return span;
	}

	override updateDOM(): boolean {
		return false;
	}

	override isInline(): boolean {
		return true;
	}

	override getTextContent(): string {
		return titleOf(this.__pageId) ?? "Deleted page";
	}

	override decorate(): null {
		return null;
	}
}

export function $createPageLinkNode(pageId: string): PageLinkNode {
	return new PageLinkNode(pageId);
}

export function $isPageLinkNode(node: LexicalNode | null | undefined): node is PageLinkNode {
	return node instanceof PageLinkNode;
}

/** Inserts a link at the selection and leaves the caret after it, ready to type. */
export function $insertPageLink(pageId: string): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const link = $createPageLinkNode(pageId);
	selection.insertNodes([link]);
	const next = link.getNextSibling();
	if ($isTextNode(next) && /^\s/.test(next.getTextContent())) {
		next.select(1, 1);
	} else {
		const space = $createTextNode(" ");
		link.insertAfter(space);
		space.select(1, 1);
	}
}

const PAGE_URL =
	/^(?:https?:\/\/([^/\s]+))?\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/;

/** The page id in a link to a page of this app, if `text` is one. */
export function pageIdFromUrl(text: string): string | null {
	const found = PAGE_URL.exec(text.trim());
	if (!found) return null;
	if (found[1] && found[1] !== location.host) return null;
	return found[2] ?? null;
}

/**
 * Clicking a link opens the page (after saving any last edits). Pasting a page's
 * address turns it into a link. Links redraw when pages are renamed or deleted.
 */
export function registerPageLinks(
	editor: LexicalEditor,
	host: HTMLElement & { flush(): Promise<void> },
): () => void {
	const onClick = (event: MouseEvent) => {
		const link = (event.target as Element).closest<HTMLAnchorElement>(".ne-page-link a[href]");
		if (!link || !host.contains(link)) return;
		event.preventDefault();
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) {
			window.open(link.href, "_blank", "noopener");
			return;
		}
		void host.flush().finally(() => location.assign(link.href));
	};
	host.addEventListener("click", onClick);
	host.addEventListener("auxclick", onClick);

	const repaint = () => {
		for (const dom of host.querySelectorAll<HTMLElement>(".ne-page-link[data-page-id]")) {
			paint(dom, dom.dataset.pageId!);
		}
	};

	// Browsers move the caret unreliably across a non-editable inline element, so
	// step over a link in one key press ourselves.
	const hop = (backward: boolean) => (event: KeyboardEvent) => {
		if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
		const selection = $getSelection();
		if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
		const node = $getAdjacentNode(selection.focus, backward);
		if (!$isPageLinkNode(node)) return false;
		event.preventDefault();
		if (backward) node.selectPrevious();
		else node.selectNext(0, 0);
		return true;
	};

	return mergeRegister(
		onPagesChange(repaint),
		editor.registerCommand(KEY_ARROW_LEFT_COMMAND, hop(true), COMMAND_PRIORITY_LOW),
		editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, hop(false), COMMAND_PRIORITY_LOW),
		editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
				// Copies from another page carry Lexical's own format; let that paste as-is.
				if (event.clipboardData.types.includes("application/x-lexical-editor")) return false;
				const pageId = pageIdFromUrl(event.clipboardData.getData("text/plain"));
				if (!pageId || pageId === currentPageId()) return false;
				const selection = $getSelection();
				if (!$isRangeSelection(selection)) return false;
				if ($isCodeNode(selection.anchor.getNode().getTopLevelElement())) return false;
				event.preventDefault();
				$insertPageLink(pageId);
				return true;
			},
			COMMAND_PRIORITY_NORMAL,
		),
		() => {
			host.removeEventListener("click", onClick);
			host.removeEventListener("auxclick", onClick);
		},
	);
}
