import {
	$createTableNodeWithDimensions,
	$deleteTableColumnAtSelection,
	$deleteTableRowAtSelection,
	$insertTableColumnAtNode,
	$insertTableColumnAtSelection,
	$insertTableRowAtNode,
	$insertTableRowAtSelection,
	$isTableCellNode,
	$isTableNode,
	$isTableRowNode,
	$isTableSelection,
	$setTableColumnIsHeader,
	$setTableRowIsHeader,
	TableCellHeaderStates,
	type TableCellNode,
	type TableNode,
} from "@lexical/table";
import { $findMatchingParent } from "@lexical/utils";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	type NodeKey,
} from "lexical";

import { $anchorBlock, $ensureLineAfter, $replaceOrInsertAfter } from "../../shared/blocks";

export function $table(key: NodeKey | null): TableNode | null {
	const node = key ? $getNodeByKey(key) : null;
	return $isTableNode(node) ? node : null;
}

/** The last cell of the table's first or last row. */
function $lastCell(table: TableNode, row: "first" | "last"): TableCellNode | null {
	const tr = row === "first" ? table.getFirstChild() : table.getLastChild();
	const cell = $isTableRowNode(tr) ? tr.getLastChild() : null;
	return $isTableCellNode(cell) ? cell : null;
}

/** The table a DOM element is in. */
export function $tableKeyAt(dom: Element): NodeKey | null {
	const node = $getNearestNodeFromDOMNode(dom);
	return node ? ($findMatchingParent(node, $isTableNode)?.getKey() ?? null) : null;
}

/** The cell holding the caret (or a table selection's anchor). */
export function $caretCellKey(): NodeKey | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return null;
	const node = selection.anchor.getNode();
	const cell = $isTableCellNode(node) ? node : $findMatchingParent(node, $isTableCellNode);
	return cell?.getKey() ?? null;
}

/** Adds a row at the bottom or a column at the right. */
export function $appendLine(tableKey: NodeKey | null, line: "row" | "column"): void {
	const table = $table(tableKey);
	const cell = table && $lastCell(table, line === "row" ? "last" : "first");
	if (!cell) return;
	if (line === "row") $insertTableRowAtNode(cell, true);
	else $insertTableColumnAtNode(cell, true, false);
}

/** A 3×3 table with a header row, replacing the current line if it is empty. */
export function $insertTable(): void {
	const block = $anchorBlock();
	if (!block) return;
	const table = $createTableNodeWithDimensions(3, 3, { rows: true, columns: false });
	$replaceOrInsertAfter(block, table);
	// Leave somewhere to keep writing below the table.
	$ensureLineAfter(table);
	table.getFirstDescendant()?.selectStart();
}

/** An entry of the cell menu; `run` is called inside `editor.update`. A null `run` is a divider. */
export interface TableMenuEntry {
	label: string;
	run: (() => void) | null;
	checked?: boolean;
	danger?: boolean;
}

/** The cell menu for the cell `cellKey` (empty when it's gone). */
export function $tableMenu(cellKey: NodeKey | null): TableMenuEntry[] {
	const cell = cellKey ? $getNodeByKey(cellKey) : null;
	const table = $isTableCellNode(cell) ? $findMatchingParent(cell, $isTableNode) : null;
	if (!table) return [];
	const first = $lastCell(table, "first")?.getParent()?.getFirstChild();
	const headerRow = $isTableCellNode(first) && first.hasHeaderState(TableCellHeaderStates.ROW);
	const headerCol = $isTableCellNode(first) && first.hasHeaderState(TableCellHeaderStates.COLUMN);
	const key = table.getKey();
	const divider = { label: "", run: null };
	return [
		{ label: "Insert row above", run: () => $insertTableRowAtSelection(false) },
		{ label: "Insert row below", run: () => $insertTableRowAtSelection(true) },
		{ label: "Insert column left", run: () => $insertTableColumnAtSelection(false) },
		{ label: "Insert column right", run: () => $insertTableColumnAtSelection(true) },
		divider,
		{
			label: "Header row",
			checked: headerRow,
			run: () => {
				const t = $table(key);
				if (t) $setTableRowIsHeader(t, 0, !headerRow);
			},
		},
		{
			label: "Header column",
			checked: headerCol,
			run: () => {
				const t = $table(key);
				if (t) $setTableColumnIsHeader(t, 0, !headerCol);
			},
		},
		divider,
		{ label: "Delete row", danger: true, run: $deleteTableRowAtSelection },
		{ label: "Delete column", danger: true, run: $deleteTableColumnAtSelection },
		{
			label: "Delete table",
			danger: true,
			run: () => {
				const t = $table(key);
				if (!t) return;
				const paragraph = $createParagraphNode();
				t.replace(paragraph);
				paragraph.select();
			},
		},
	];
}

/** The index of the next runnable entry from `active` in direction `step` (wrapping). */
export function nextEntry(entries: TableMenuEntry[], active: number, step: 1 | -1): number {
	const order = entries.flatMap((entry, i) => (entry.run ? [i] : []));
	const at = order.indexOf(active);
	const next =
		at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length;
	return order[next] ?? -1;
}
