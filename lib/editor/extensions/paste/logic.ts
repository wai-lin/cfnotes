import { $convertFromMarkdownString } from "@lexical/markdown";
import { $isTextNode, createEditor, type DOMConversionMap, type LexicalNode } from "lexical";

import type { EditorSchema } from "../../core/extension.ts";
import { BACK_COLORS, snapToPalette, TEXT_COLORS, type Palette } from "../../shared/colors.ts";

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
export function spanImport(
	textColors: Palette = TEXT_COLORS,
	backColors: Palette = BACK_COLORS,
): DOMConversionMap {
	return {
		span: (domNode: HTMLElement) => ({
			priority: 1,
			conversion: () => {
				const style = domNode.style;
				const formats = formatsFromStyle(style);
				const color = style.color ? snapToPalette(style.color, textColors) : null;
				const background = style.backgroundColor
					? snapToPalette(style.backgroundColor, backColors)
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
}

/** Serialized blocks for `markdown`, converted in a scratch editor with the same nodes. */
export function markdownToJSON(markdown: string, schema: EditorSchema) {
	const scratch = createEditor({
		namespace: "editor-paste",
		theme: schema.theme,
		nodes: schema.nodes,
		onError: (error) => console.error("[paste]", error),
	});
	scratch.update(() => $convertFromMarkdownString(markdown, schema.transformers), {
		discrete: true,
	});
	return scratch.getEditorState().toJSON().root.children;
}
