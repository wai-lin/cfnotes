import { $isListNode } from "@lexical/list";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

import type { BlockItem } from "../../core/extension.ts";
import {
	$duplicateBlock,
	$duplicateBlocks,
	$isEmptyParagraph,
	$removeBlock,
	$removeBlocks,
	$selectBlocks,
	$turnBlocksInto,
} from "../../shared/blocks.ts";
import { DROP_BESIDE_COMMAND } from "../../shared/commands.ts";

/** Where dragged blocks go: before or after a block, or beside it as a column. */
export interface DropTarget {
	key: NodeKey;
	before: boolean;
	side: "left" | "right" | null;
}

/**
 * Where a drag over a block's box lands: before or after it by the half the
 * pointer is in, or (with `sides`) beside it as a column past its edges: its
 * right part, or left of the grip, so a drag straight down from the grip
 * (which drifts a little either way) still just moves the block.
 */
export function dropPlacement(
	rect: { left: number; right: number; top: number; height: number; width: number },
	x: number,
	y: number,
	sides: boolean,
): Pick<DropTarget, "before" | "side"> {
	const side = !sides
		? null
		: x >= rect.right - Math.min(120, rect.width * 0.3)
			? "right"
			: x <= rect.left - 32
				? "left"
				: null;
	return { before: y < rect.top + rect.height / 2, side };
}

/** The top-level block a DOM element belongs to. */
export function $blockKeyOf(dom: Element): NodeKey | null {
	const node = $getNearestNodeFromDOMNode(dom);
	return node?.getTopLevelElement()?.getKey() ?? node?.getKey() ?? null;
}

/** The top-level block of a DOM element (a column's own block inside columns). */
export function $topLevelKeyOf(dom: Element): NodeKey | null {
	return $getNearestNodeFromDOMNode(dom)?.getTopLevelElement()?.getKey() ?? null;
}

const $nodes = (keys: NodeKey[]) => keys.flatMap((key) => $getNodeByKey(key) ?? []);

/** `+`: a fresh "/" line below the block (or on it, when it's an empty line). */
export function $startSlashLineAfter(key: NodeKey): void {
	const node = $getNodeByKey(key);
	if (!node) return;
	if ($isEmptyParagraph(node)) {
		node.select().insertText("/");
		return;
	}
	const paragraph = $createParagraphNode();
	node.insertAfter(paragraph);
	paragraph.select().insertText("/");
}

/** Whether any of the blocks can be turned into another type. */
export function $anyConvertible(keys: NodeKey[], convertible: ReadonlySet<string>): boolean {
	return $nodes(keys).some((node) => convertible.has(node.getType()));
}

export function $duplicateGroup(editor: LexicalEditor, keys: NodeKey[]): void {
	const nodes = $nodes(keys);
	if (nodes.length > 1) $duplicateBlocks(editor, nodes);
	else if (nodes[0]) $duplicateBlock(editor, nodes[0].getKey());
}

export function $removeGroup(keys: NodeKey[]): void {
	const nodes = $nodes(keys);
	if (nodes.length > 1) $removeBlocks(nodes);
	else if (nodes[0]) $removeBlock(nodes[0].getKey());
}

export function $turnGroupInto(editor: LexicalEditor, keys: NodeKey[], item: BlockItem): void {
	const nodes = $nodes(keys);
	const node = nodes[0];
	if (!node) return;
	if (nodes.length > 1) return $turnBlocksInto(editor, nodes, item.apply);
	// A list converts item by item, so cover all of it.
	if ($isListNode(node)) node.select(0, node.getChildrenSize());
	else node.selectStart();
	item.apply(editor);
}

/** Moves the dragged blocks to `to`. */
export function $dropBlocks(editor: LexicalEditor, keys: NodeKey[], to: DropTarget): void {
	const target = $getNodeByKey(to.key);
	const nodes = $nodes(keys);
	if (!target || nodes.length === 0) return;
	if (
		to.side &&
		editor.dispatchCommand(DROP_BESIDE_COMMAND, { target: to.key, keys, side: to.side })
	)
		return;
	// Insert in document order, each after the previous one.
	let anchor = target;
	nodes.forEach((node, i) => {
		if (i === 0 && to.before) target.insertBefore(node);
		else anchor.insertAfter(node);
		anchor = node;
	});
	if (keys.length > 1) $selectBlocks(keys);
}
