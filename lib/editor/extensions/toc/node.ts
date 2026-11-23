import { DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode } from "lexical";

/** A table of contents: the page's headings, kept up to date by the extension. */
export class TocNode extends DecoratorNode<null> {
	static override getType(): string {
		return "toc";
	}

	static override clone(node: TocNode): TocNode {
		return new TocNode(node.__key);
	}

	static override importJSON(json: SerializedLexicalNode): TocNode {
		return $createTocNode().updateFromJSON(json);
	}

	constructor(key?: NodeKey) {
		super(key);
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("nav");
		dom.className = "ne-toc";
		dom.contentEditable = "false";
		dom.setAttribute("aria-label", "Table of contents");
		return dom;
	}

	override updateDOM(): boolean {
		return false;
	}

	override isInline(): boolean {
		return false;
	}

	override decorate(): null {
		return null;
	}
}

export function $createTocNode(): TocNode {
	return new TocNode();
}

export function $isTocNode(node: LexicalNode | null | undefined): node is TocNode {
	return node instanceof TocNode;
}
