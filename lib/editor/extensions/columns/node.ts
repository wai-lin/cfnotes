import {
	$applyNodeReplacement,
	ElementNode,
	type LexicalNode,
	type NodeKey,
	type SerializedElementNode,
	type Spread,
} from "lexical";

import { gridTemplate } from "./layout";

export type SerializedColumnsNode = Spread<{ widths: number[] }, SerializedElementNode>;

/**
 * Side-by-side columns, like Notion's. Holds two or more `ColumnNode`s;
 * `widths` are their shares of the row (they add up to 1).
 */
export class ColumnsNode extends ElementNode {
	__widths: number[];

	static override getType(): string {
		return "columns";
	}

	static override clone(node: ColumnsNode): ColumnsNode {
		return new ColumnsNode([...node.__widths], node.__key);
	}

	static override importJSON(json: SerializedColumnsNode): ColumnsNode {
		return $createColumnsNode(json.widths).updateFromJSON(json);
	}

	constructor(widths: number[] = [], key?: NodeKey) {
		super(key);
		this.__widths = widths;
	}

	getWidths(): number[] {
		return this.getLatest().__widths;
	}

	setWidths(widths: number[]): this {
		const writable = this.getWritable();
		writable.__widths = widths;
		return writable;
	}

	override exportJSON(): SerializedColumnsNode {
		return { ...super.exportJSON(), widths: this.getWidths() };
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-columns";
		dom.style.gridTemplateColumns = gridTemplate(this.__widths);
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__widths.join() !== this.__widths.join())
			dom.style.gridTemplateColumns = gridTemplate(this.__widths);
		return false;
	}

	override canBeEmpty(): boolean {
		return false;
	}

	override isShadowRoot(): boolean {
		return false;
	}
}

/** One column: a little document of its own (like a table cell), so typing stays inside it. */
export class ColumnNode extends ElementNode {
	static override getType(): string {
		return "column";
	}

	static override clone(node: ColumnNode): ColumnNode {
		return new ColumnNode(node.__key);
	}

	static override importJSON(json: SerializedElementNode): ColumnNode {
		return $createColumnNode().updateFromJSON(json);
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-column";
		return dom;
	}

	override updateDOM(): boolean {
		return false;
	}

	override isShadowRoot(): boolean {
		return true;
	}

	override canBeEmpty(): boolean {
		return false;
	}
}

export function $createColumnsNode(widths: number[] = []): ColumnsNode {
	return $applyNodeReplacement(new ColumnsNode(widths));
}

export function $createColumnNode(): ColumnNode {
	return $applyNodeReplacement(new ColumnNode());
}

export function $isColumnsNode(node: LexicalNode | null | undefined): node is ColumnsNode {
	return node instanceof ColumnsNode;
}

export function $isColumnNode(node: LexicalNode | null | undefined): node is ColumnNode {
	return node instanceof ColumnNode;
}
