import { mergeRegister } from "@lexical/utils";
import { $getNearestNodeFromDOMNode, COMMAND_PRIORITY_EDITOR } from "lexical";

import type { BlockItem, EditorExtension } from "../../core/extension.ts";
import { DROP_BESIDE_COMMAND } from "../../shared/commands.ts";
import { listen } from "../../shared/dom.ts";
import {
	$handleDropBeside,
	$insertColumns,
	$setWidths,
	$widthsOf,
	registerColumnRepairs,
} from "./logic.ts";
import { $isColumnNode, ColumnNode, ColumnsNode } from "./node.ts";
import { createColumnResizer } from "./view.ts";

export { $dropBeside, $insertColumns } from "./logic.ts";
export * from "./node.ts";

const columnsItem = (count: 2 | 3): BlockItem => ({
	id: `columns-${count}`,
	label: `${count} columns`,
	hint: count === 2 ? "Two blocks side by side" : "Three blocks side by side",
	keywords: `columns column layout side split ${count === 2 ? "two" : "three"} ${count}`,
	order: count === 2 ? 220 : 230,
	hiddenIn: ["table", "column"],
	apply: () => $insertColumns(count),
});

/**
 * Side-by-side columns, like Notion's: `/2 columns`, or drag a block past
 * another one's side. Drag the gap between two columns to resize them.
 */
export function columnsExtension(): EditorExtension {
	return {
		name: "columns",
		nodes: [ColumnsNode, ColumnNode],
		containers: [{ name: "column", test: $isColumnNode }],
		items: [columnsItem(2), columnsItem(3)],
		register({ editor, host }) {
			const keyOf = (row: HTMLElement) =>
				editor.read(() => $getNearestNodeFromDOMNode(row)?.getKey() ?? null);
			const resizer = createColumnResizer({
				host,
				widthsOf: (row) => {
					const key = keyOf(row);
					return key ? editor.read(() => $widthsOf(key)) : [];
				},
				onResize: (row, widths) => {
					const key = keyOf(row);
					if (key) editor.update(() => $setWidths(key, widths));
				},
			});
			return mergeRegister(
				registerColumnRepairs(editor),
				editor.registerCommand(DROP_BESIDE_COMMAND, $handleDropBeside, COMMAND_PRIORITY_EDITOR),
				listen(host, "mousemove", (event: MouseEvent) => resizer.hover(event)),
				() => resizer.destroy(),
			);
		},
	};
}
