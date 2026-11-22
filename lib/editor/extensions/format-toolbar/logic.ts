import { $isCodeNode } from "@lexical/code";
import { $patchStyleText } from "@lexical/selection";
import {
	$getSelection,
	$isRangeSelection,
	FORMAT_TEXT_COMMAND,
	type TextFormatType,
} from "lexical";

import type { ToolbarItem } from "../../core/extension.ts";
import type { IconName } from "../../shared/icons.ts";

const FORMATS: { format: TextFormatType; icon: IconName; label: string }[] = [
	{ format: "bold", icon: "bold", label: "Bold (⌘B)" },
	{ format: "italic", icon: "italic", label: "Italic (⌘I)" },
	{ format: "underline", icon: "underline", label: "Underline (⌘U)" },
	{ format: "strikethrough", icon: "strikethrough", label: "Strikethrough" },
	{ format: "code", icon: "code", label: "Inline code (⌘E)" },
];

/** B / i / U / S / code: toggle the format, lit while the selection has it. */
export const FORMAT_ITEMS: ToolbarItem[] = FORMATS.map(({ format, icon, label }, i) => ({
	id: format,
	icon,
	label,
	order: (i + 1) * 10,
	run: (editor) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
	isActive: () => {
		const selection = $getSelection();
		return $isRangeSelection(selection) && selection.hasFormat(format);
	},
}));

/**
 * The ids of the lit buttons for the selection, or null when the bar should
 * hide (no text selected, or inside a code block). Call inside `editor.read`.
 */
export function $toolbarFor(items: ToolbarItem[]): Set<string> | null {
	const selection = $getSelection();
	if (
		!$isRangeSelection(selection) ||
		selection.isCollapsed() ||
		selection.getTextContent() === "" ||
		$isCodeNode(selection.anchor.getNode().getTopLevelElement())
	)
		return null;
	return new Set(items.filter((item) => item.isActive?.()).map((item) => item.id));
}

/** Sets (or, with null, clears) CSS properties on the selected text. Call inside `editor.update`. */
export function $styleSelection(styles: Record<string, string | null>): void {
	const selection = $getSelection();
	if ($isRangeSelection(selection)) $patchStyleText(selection, styles);
}
