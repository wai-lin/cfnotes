import type { ElementTransformer } from "@lexical/markdown";
import {
	$applyNodeReplacement,
	DecoratorNode,
	type DOMConversionMap,
	type DOMExportOutput,
	type LexicalNode,
	type SerializedLexicalNode,
} from "lexical";

export type SerializedDividerNode = SerializedLexicalNode;

/** A horizontal rule, like Notion's divider block. */
export class DividerNode extends DecoratorNode<null> {
	static override getType(): string {
		return "divider";
	}

	static override clone(node: DividerNode): DividerNode {
		return new DividerNode(node.__key);
	}

	static override importJSON(json: SerializedDividerNode): DividerNode {
		return $createDividerNode().updateFromJSON(json);
	}

	override exportJSON(): SerializedDividerNode {
		return super.exportJSON();
	}

	static override importDOM(): DOMConversionMap {
		return { hr: () => ({ priority: 0, conversion: () => ({ node: $createDividerNode() }) }) };
	}

	override exportDOM(): DOMExportOutput {
		return { element: document.createElement("hr") };
	}

	override createDOM(): HTMLElement {
		const wrap = document.createElement("div");
		wrap.className = "ne-hr";
		wrap.append(document.createElement("hr"));
		return wrap;
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

export function $createDividerNode(): DividerNode {
	return $applyNodeReplacement(new DividerNode());
}

export function $isDividerNode(node: LexicalNode | null | undefined): node is DividerNode {
	return node instanceof DividerNode;
}

/** `---`, `***` or `___` on their own line become a divider. */
export const DIVIDER_TRANSFORMER: ElementTransformer = {
	dependencies: [DividerNode],
	export: (node) => ($isDividerNode(node) ? "---" : null),
	regExp: /^(-{3,}|\*{3,}|_{3,})\s?$/,
	replace: (parentNode, _children, _match, isImport) => {
		const divider = $createDividerNode();
		// On import keep going; while typing, land on the line after the rule.
		if (isImport || parentNode.getNextSibling() != null) parentNode.replace(divider);
		else parentNode.insertBefore(divider);
		divider.selectNext();
	},
	type: "element",
};
