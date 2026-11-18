import { registerMarkdownShortcuts, TEXT_FORMAT_TRANSFORMERS } from "@lexical/markdown";

import { ranked, type EditorExtension } from "../../core/extension";

/**
 * Markdown while typing (`# `, `- `, `**bold**`…), with the rules every
 * extension contributes. Also brings the text-format rules (bold, italic, code…).
 */
export function markdownExtension(): EditorExtension {
	return {
		name: "markdown",
		markdown: ranked(20, ...TEXT_FORMAT_TRANSFORMERS),
		register: ({ editor, schema }) => registerMarkdownShortcuts(editor, schema.transformers),
	};
}
