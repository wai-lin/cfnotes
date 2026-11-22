import {
	DecoratorNode,
	type DOMConversionMap,
	type DOMExportOutput,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { hrefOf, titleOf } from "./config.ts";
import { PAGE_LINK_TYPE } from "./type.ts";
import { paintPageLink } from "./view.ts";

export type SerializedPageLinkNode = Spread<{ pageId: string }, SerializedLexicalNode>;

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
		a.href = hrefOf(this.__pageId);
		a.setAttribute("data-page-link", this.__pageId);
		a.textContent = this.getTextContent();
		return { element: a };
	}

	override createDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "ne-page-link";
		span.contentEditable = "false";
		span.dataset.pageId = this.__pageId;
		paintPageLink(span, titleOf(this.__pageId), hrefOf(this.__pageId));
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
