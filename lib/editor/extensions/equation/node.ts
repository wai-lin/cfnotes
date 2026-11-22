import {
	DecoratorNode,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { createEquationElement, drawEquation } from "./view.ts";

export type SerializedEquationNode = Spread<
	{ equation: string; inline: boolean },
	SerializedLexicalNode
>;

export const MAX_EQUATION = 4000;

/**
 * A TeX equation rendered with KaTeX: inline inside a line of text, or a
 * centered block of its own. Clicking it opens a small editor below it.
 */
export class EquationNode extends DecoratorNode<null> {
	__equation: string;
	__inline: boolean;

	static override getType(): string {
		return "equation";
	}

	static override clone(node: EquationNode): EquationNode {
		return new EquationNode(node.__equation, node.__inline, node.__key);
	}

	static override importJSON(json: SerializedEquationNode): EquationNode {
		return $createEquationNode(json.equation, json.inline).updateFromJSON(json);
	}

	constructor(equation = "", inline = false, key?: NodeKey) {
		super(key);
		this.__equation = equation.slice(0, MAX_EQUATION);
		this.__inline = inline;
	}

	getEquation(): string {
		return this.__equation;
	}

	setEquation(equation: string): this {
		const writable = this.getWritable();
		writable.__equation = equation.slice(0, MAX_EQUATION);
		return writable;
	}

	override exportJSON(): SerializedEquationNode {
		return { ...super.exportJSON(), equation: this.__equation, inline: this.__inline };
	}

	/** Copying out to other apps: the TeX source, as markdown-style math. */
	override exportDOM(): DOMExportOutput {
		const element = document.createElement(this.__inline ? "span" : "div");
		element.textContent = this.__inline ? `$$${this.__equation}$$` : `$$\n${this.__equation}\n$$`;
		return { element };
	}

	override getTextContent(): string {
		return this.__equation;
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		return createEquationElement(this.__equation, this.__inline);
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__inline !== this.__inline) return true;
		if (prevNode.__equation !== this.__equation) drawEquation(dom, this.__equation, !this.__inline);
		return false;
	}

	override isInline(): boolean {
		return this.__inline;
	}

	override decorate(): null {
		return null;
	}
}

export function $createEquationNode(equation = "", inline = false): EquationNode {
	return new EquationNode(equation, inline);
}

export function $isEquationNode(node: LexicalNode | null | undefined): node is EquationNode {
	return node instanceof EquationNode;
}
