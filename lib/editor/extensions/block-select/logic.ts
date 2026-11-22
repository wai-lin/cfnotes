import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getRoot,
	$getSelection,
	$isDecoratorNode,
	$isElementNode,
	$isNodeSelection,
	$isRangeSelection,
	$setSelection,
	type LexicalNode,
	type NodeKey,
} from "lexical";

import { $removeBlocks, $selectBlocks, $selectedBlocks } from "../../shared/blocks.ts";

/**
 * Escape: a block selection clears; while editing, the block being edited
 * gets selected. Returns the newly selected block, `true` when cleared, or
 * null when Escape isn't for us.
 */
export function $escape(): NodeKey | true | null {
	const selection = $getSelection();
	if ($isNodeSelection(selection)) {
		$setSelection(null);
		return true;
	}
	if (!$isRangeSelection(selection)) return null;
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block) return null;
	$selectBlocks([block.getKey()]);
	return block.getKey();
}

/**
 * ↑/↓ with blocks selected: move the selection one block (`extend`: grow or
 * shrink it from `anchorKey`). Returns the new anchor, or undefined when no
 * blocks are selected.
 */
export function $stepSelection(
	dir: -1 | 1,
	extend: boolean,
	anchorKey: NodeKey | null,
): NodeKey | null | undefined {
	const blocks = $selectedBlocks();
	if (blocks.length === 0) return undefined;
	// Siblings: the page's blocks, or a column's when the selection is inside one.
	const all = blocks[0]?.getParent()?.getChildren() ?? $getRoot().getChildren();
	const first = all.indexOf(blocks[0] as LexicalNode);
	const last = all.indexOf(blocks.at(-1) as LexicalNode);
	if (extend) {
		const anchor = anchorKey ? all.findIndex((b) => b.getKey() === anchorKey) : first;
		const from = anchor >= 0 ? anchor : first;
		// The moving end is whichever end isn't the anchor.
		const head = from === first ? last : first;
		const next = Math.min(all.length - 1, Math.max(0, head + dir));
		const [lo, hi] = from <= next ? [from, next] : [next, from];
		$selectBlocks(all.slice(lo, hi + 1).map((b) => b.getKey()));
		return anchorKey ?? all[from]?.getKey() ?? null;
	}
	const target = all[Math.min(all.length - 1, Math.max(0, (dir < 0 ? first : last) + dir))];
	if (!target) return anchorKey;
	$selectBlocks([target.getKey()]);
	return target.getKey();
}

/** Backspace/Delete with blocks selected removes them. False when none are. */
export function $deleteSelectedBlocks(): boolean {
	const blocks = $selectedBlocks();
	if (blocks.length === 0) return false;
	$removeBlocks(blocks);
	return true;
}

/**
 * Enter with blocks selected edits the first one. A single selected image or
 * file keeps Lexical's own Enter (a line after it): false.
 */
export function $editFirstSelected(): boolean {
	const blocks = $selectedBlocks();
	const first = blocks[0];
	if (!first || (blocks.length === 1 && $isDecoratorNode(first))) return false;
	if ($isElementNode(first)) first.selectEnd();
	else first.insertAfter($createParagraphNode()).selectStart();
	return true;
}

/** Selects the blocks of these elements; returns the first one's key. */
export function $selectElements(elements: HTMLElement[]): NodeKey | null {
	const keys = elements.flatMap((element) => {
		const node = $getNearestNodeFromDOMNode(element);
		const block = node?.getTopLevelElement() ?? node;
		return block ? [block.getKey()] : [];
	});
	$selectBlocks(keys);
	return keys[0] ?? null;
}
