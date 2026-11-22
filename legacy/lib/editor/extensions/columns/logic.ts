import { mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$isRootNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";

import { $ensureLineAfter, $replaceOrInsertAfter } from "../../shared/blocks";
import { equalWidths, validWidths } from "./layout";
import {
	$createColumnNode,
	$createColumnsNode,
	$isColumnNode,
	$isColumnsNode,
	ColumnNode,
	ColumnsNode,
} from "./node";

/** A row of `count` empty columns after the current block (replacing it if empty). */
export function $insertColumns(count: number): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	let block: LexicalNode | null = selection.anchor.getNode();
	// Columns don't nest: from inside one, add the row below the whole set.
	while (block && !$isRootNode(block.getParent())) block = block.getParent();
	if (!block) return;
	const columns = $createColumnsNode(equalWidths(count));
	for (let i = 0; i < count; i++)
		columns.append($createColumnNode().append($createParagraphNode()));
	$replaceOrInsertAfter(block, columns);
	$ensureLineAfter(columns);
	columns.getFirstDescendant()?.selectStart();
}

/**
 * Drops `nodes` beside `target` as a new column (Notion's drag-to-side). A
 * target inside columns gets a new column next to its own; any other block
 * becomes a two-column row with the dropped blocks.
 */
export function $dropBeside(
	target: LexicalNode,
	nodes: LexicalNode[],
	side: "left" | "right",
): void {
	const column = $createColumnNode();
	column.append(...nodes);
	const own = target.getParent();
	if ($isColumnNode(own)) {
		if (side === "left") own.insertBefore(column);
		else own.insertAfter(column);
		// Even shares for all; dragging the gaps fine-tunes them.
		const row = own.getParent();
		if ($isColumnsNode(row)) {
			row.setWidths(equalWidths(row.getChildrenSize()));
			$ensureLineAfter(row);
		}
		return;
	}
	const columns = $createColumnsNode(equalWidths(2));
	target.insertBefore(columns);
	const home = $createColumnNode();
	home.append(target);
	columns.append(...(side === "left" ? [column, home] : [home, column]));
	// Somewhere below the row to click into or drop onto.
	$ensureLineAfter(columns);
}

/**
 * The drop-beside command: false when a whole row of columns is among the
 * blocks (it can't go inside another column).
 */
export function $handleDropBeside(payload: {
	target: NodeKey;
	keys: NodeKey[];
	side: "left" | "right";
}): boolean {
	const target = $getNodeByKey(payload.target);
	const nodes = payload.keys.flatMap((key) => $getNodeByKey(key) ?? []);
	if (!target || nodes.length === 0 || nodes.some($isColumnsNode)) return false;
	$dropBeside(target, nodes, payload.side);
	return true;
}

/** Saves a row's widths after a resize. */
export function $setWidths(key: NodeKey, widths: number[]): void {
	const node = $getNodeByKey(key);
	if ($isColumnsNode(node)) node.setWidths(widths);
}

/** A row's widths (empty if it's gone). */
export function $widthsOf(key: NodeKey): number[] {
	const node = $getNodeByKey(key);
	return $isColumnsNode(node) ? [...node.getWidths()] : [];
}

/**
 * Keeps the structure valid whatever edits do: columns only in rows at the top
 * level, rows of two or more, no empty columns, one width per column.
 */
export function registerColumnRepairs(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerNodeTransform(ColumnNode, (column) => {
			const parent = column.getParent();
			if (!$isColumnsNode(parent)) {
				// A stray column: its blocks take its place.
				for (const child of column.getChildren()) column.insertBefore(child);
				column.remove();
			} else if (column.isEmpty()) column.remove();
		}),
		editor.registerNodeTransform(ColumnsNode, (row) => {
			const unwrap = () => {
				for (const child of row.getChildren())
					for (const block of $isColumnNode(child) ? child.getChildren() : [child])
						row.insertBefore(block);
				row.remove();
			};
			if (!$isRootNode(row.getParent())) return unwrap();
			// Anything that isn't a column moves out below the row.
			for (const child of row.getChildren().reverse())
				if (!$isColumnNode(child)) row.insertAfter(child);
			const count = row.getChildrenSize();
			if (count < 2) return unwrap();
			if (!validWidths(row.getWidths(), count)) row.setWidths(equalWidths(count));
		}),
	);
}
