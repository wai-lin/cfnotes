import { $generateNodesFromSerializedNodes, $insertGeneratedNodes } from "@lexical/clipboard";
import { $isCodeNode } from "@lexical/code";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { looksLikeMarkdown } from "@modules/markdown";
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isDecoratorNode,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	createEditor,
	PASTE_COMMAND,
	type DOMConversionMap,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";

import { BACK_COLORS, snapToPalette, TEXT_COLORS } from "./colors";
import { EDITOR_NODES, MARKDOWN_TRANSFORMERS } from "./nodes";
import { theme } from "./theme";

/** Text formats Lexical reads from a span's inline style (as its own span rule does). */
function formatsFromStyle(style: CSSStyleDeclaration) {
	const decoration = style.textDecoration.split(" ");
	return {
		bold: style.fontWeight === "700" || style.fontWeight === "bold",
		italic: style.fontStyle === "italic",
		underline: decoration.includes("underline"),
		strikethrough: decoration.includes("line-through"),
		subscript: style.verticalAlign === "sub",
		superscript: style.verticalAlign === "super",
	} as const;
}

/**
 * Editor-level HTML import overrides. Spans keep Lexical's bold/italic/…
 * reading of inline styles, and also bring text and highlight colors when
 * they match the palette (Notion's colors, or ours copied from another page).
 */
export const HTML_IMPORT: DOMConversionMap = {
	span: (domNode: HTMLElement) => ({
		priority: 1,
		conversion: () => {
			const style = domNode.style;
			const formats = formatsFromStyle(style);
			const color = style.color ? snapToPalette(style.color, TEXT_COLORS) : null;
			const background = style.backgroundColor
				? snapToPalette(style.backgroundColor, BACK_COLORS)
				: null;
			return {
				node: null,
				forChild: (child: LexicalNode) => {
					if (!$isTextNode(child)) return child;
					for (const [format, on] of Object.entries(formats))
						if (on && !child.hasFormat(format as keyof typeof formats))
							child.toggleFormat(format as keyof typeof formats);
					const css = [
						child.getStyle(),
						color ? `color: ${color}` : "",
						background ? `background-color: ${background}` : "",
					]
						.filter(Boolean)
						.join("; ");
					if (css) child.setStyle(css);
					return child;
				},
			};
		},
	}),
};

/** Serialized blocks for `markdown`, converted in a scratch editor with the same nodes. */
function markdownToJSON(markdown: string) {
	const scratch = createEditor({
		namespace: "cfnotes-paste",
		theme,
		nodes: EDITOR_NODES,
		onError: (error) => console.error("[paste]", error),
	});
	scratch.update(() => $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS), {
		discrete: true,
	});
	return scratch.getEditorState().toJSON().root.children;
}

/**
 * Pasting markdown as plain text (from an editor, a chat, a README) inserts
 * real headings, lists, to-dos, quotes, code blocks, dividers, links and
 * formatting. HTML pastes go through Lexical's importer with the overrides
 * above; copies from another cfnotes page use Lexical's own format.
 */
export function registerPaste(editor: LexicalEditor): () => void {
	return editor.registerCommand(
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
			const nodes = $generateNodesFromSerializedNodes(markdownToJSON(text.replace(/\r\n?/g, "\n")));
			$insertGeneratedNodes(editor, nodes, selection);
			// Ending on a divider or image: leave a line to keep writing on.
			const last = $getRoot().getLastChild();
			if ($isDecoratorNode(last) && !last.isInline())
				last.insertAfter($createParagraphNode()).selectStart();
			return true;
		},
		COMMAND_PRIORITY_HIGH,
	);
}
