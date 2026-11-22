import { $generateNodesFromSerializedNodes, $insertGeneratedNodes } from "@lexical/clipboard";
import { $isCodeNode } from "@lexical/code";
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isDecoratorNode,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	PASTE_COMMAND,
} from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import type { Palette } from "../../shared/colors.ts";
import { looksLikeMarkdown } from "./detect.ts";
import { markdownToJSON, spanImport } from "./logic.ts";

export { looksLikeMarkdown } from "./detect.ts";

/**
 * Better pasting. Markdown pasted as plain text (from an editor, a chat, a
 * README) becomes real headings, lists, to-dos, quotes, code blocks,
 * dividers, links and formatting. Pasted HTML keeps text and highlight colors
 * from the palette. Copies from another page use Lexical's own format.
 */
export function pasteExtension(palettes: { text?: Palette; back?: Palette } = {}): EditorExtension {
	return {
		name: "paste",
		html: spanImport(palettes.text, palettes.back),
		register: ({ editor, schema }) =>
			editor.registerCommand(
				PASTE_COMMAND,
				(event) => {
					if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
					const data = event.clipboardData;
					const types = [...data.types];
					if (types.includes("application/x-lexical-editor") || data.files.length > 0) return false;
					// Rich HTML is imported as HTML, except code editors' (VS Code adds styled spans).
					if (types.includes("text/html") && !types.includes("vscode-editor-data")) return false;
					const text = data.getData("text/plain");
					if (!looksLikeMarkdown(text)) return false;

					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return false;
					if ($isCodeNode(selection.anchor.getNode().getTopLevelElement())) return false;

					event.preventDefault();
					const json = markdownToJSON(text.replace(/\r\n?/g, "\n"), schema);
					$insertGeneratedNodes(editor, $generateNodesFromSerializedNodes(json), selection);
					// Ending on a divider or image: leave a line to keep writing on.
					const last = $getRoot().getLastChild();
					if ($isDecoratorNode(last) && !last.isInline())
						last.insertAfter($createParagraphNode()).selectStart();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
	};
}
