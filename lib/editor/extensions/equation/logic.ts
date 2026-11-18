import type { MultilineElementTransformer, TextMatchTransformer } from "@lexical/markdown";
import {
	$createNodeSelection,
	$getNodeByKey,
	$getSelection,
	$isNodeSelection,
	$isRangeSelection,
	$setSelection,
	type NodeKey,
} from "lexical";

import { $insertBlocks, $lineAfter, $selectedBlockKey } from "../../shared/blocks";
import { $createEquationNode, $isEquationNode, EquationNode } from "./node";

/** An equation just made (by the command or the `$$ ` shortcut), to open once it's on the page. */
let pendingOpen: NodeKey | null = null;

export function takePendingOpen(): NodeKey | null {
	const key = pendingOpen;
	pendingOpen = null;
	return key;
}

/** `$$E = mc^2$$` inside a line becomes an inline equation. */
export const INLINE_EQUATION_TRANSFORMER: TextMatchTransformer = {
	dependencies: [EquationNode],
	export: (node) => ($isEquationNode(node) && node.isInline() ? `$$${node.getEquation()}$$` : null),
	importRegExp: /\$\$([^$\n]+?)\$\$/,
	regExp: /\$\$([^$\n]+?)\$\$$/,
	trigger: "$",
	replace: (textNode, match) => {
		textNode.replace($createEquationNode(match[1].trim(), true));
	},
	type: "text-match",
};

/**
 * A block equation: `$$` then a space at the start of a line while typing; in
 * pasted markdown, a `$$ … $$` block (on one line or several).
 */
export const BLOCK_EQUATION_TRANSFORMER: MultilineElementTransformer = {
	dependencies: [EquationNode],
	export: (node) =>
		$isEquationNode(node) && !node.isInline() ? `$$\n${node.getEquation()}\n$$` : null,
	// Only when the rest of the line has no `$$` (other than closing it), so a
	// line that starts with an inline equation stays a line.
	regExpStart: /^\$\$(?=[^$]*(?:\$\$\s*)?$)/,
	regExpEnd: { optional: true, regExp: /\$\$\s*$/ },
	replace: (parent, children, _start, _end, lines, isImport) => {
		if (!children && lines) {
			const equation = lines.join("\n").trim();
			parent.append($createEquationNode(equation, false));
			return;
		}
		if (isImport) return false;
		const node = $createEquationNode("", false);
		parent.replace(node);
		node.selectNext();
		pendingOpen = node.getKey();
	},
	type: "multiline-element",
};

/**
 * Inserts an equation: inline at the selection (from the selected text, if
 * any), or as a block. Its editor opens unless it already has TeX.
 */
export function $insertEquation(inline: boolean): boolean {
	const selection = $getSelection();
	let node: EquationNode;
	let edit = true;
	if (inline) {
		if (!$isRangeSelection(selection)) return false;
		// Selected text becomes the equation.
		const text = selection.getTextContent().replace(/\s+/g, " ").trim();
		node = $createEquationNode(text, true);
		selection.insertNodes([node]);
		edit = text === "";
	} else {
		node = $createEquationNode("", false);
		$insertBlocks([node], $selectedBlockKey());
	}
	if (edit) pendingOpen = node.getKey();
	return true;
}

/** The equation selected on its own (as a block), if any. */
export function $selectedEquationKey(): NodeKey | null {
	const selection = $getSelection();
	if (!$isNodeSelection(selection)) return null;
	const nodes = selection.getNodes();
	return nodes.length === 1 && $isEquationNode(nodes[0]) ? nodes[0].getKey() : null;
}

/**
 * Saves an edit (`value`, or the original when cancelled) and moves on: an
 * emptied inline equation goes away; Done continues below a block equation,
 * Escape selects it.
 */
export function $finishEquation(key: NodeKey, value: string, commit: boolean): void {
	const node = $getNodeByKey(key);
	if (!$isEquationNode(node)) return;
	const inline = node.isInline();
	if (inline && value === "") {
		const prev = node.getPreviousSibling();
		node.remove();
		prev?.selectEnd();
		return;
	}
	if (node.getEquation() !== value) node.setEquation(value);
	if (inline) node.selectNext(0, 0);
	else if (commit) $lineAfter(node).selectStart();
	else {
		const selection = $createNodeSelection();
		selection.add(key);
		$setSelection(selection);
	}
}
