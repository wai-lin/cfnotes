import { ranked, type EditorExtension } from "../../core/extension";
import { $anchorBlock, $lineAfter, $replaceOrInsertAfter } from "../../shared/blocks";
import { $createDividerNode, DIVIDER_TRANSFORMER, DividerNode } from "./node";

export * from "./node";

/** A divider after the current block, replacing it if it is an empty paragraph. */
export function $insertDivider(): void {
	const block = $anchorBlock();
	if (!block) return;
	const divider = $createDividerNode();
	$replaceOrInsertAfter(block, divider);
	$lineAfter(divider).selectStart();
}

/** Horizontal rules: `/divider`, or `---` on a line of its own. */
export function dividerExtension(): EditorExtension {
	return {
		name: "divider",
		nodes: [DividerNode],
		// Before list items, so `---` isn't read as one.
		markdown: ranked(100, DIVIDER_TRANSFORMER),
		items: [
			{
				id: "divider",
				label: "Divider",
				hint: "Visually divide blocks",
				keywords: "divider hr rule line separator",
				order: 130,
				hiddenIn: ["table"],
				apply: $insertDivider,
			},
		],
	};
}
