import { HEADING, QUOTE } from "@lexical/markdown";
import {
	$createHeadingNode,
	$createQuoteNode,
	HeadingNode,
	QuoteNode,
	registerRichText,
} from "@lexical/rich-text";
import { $createParagraphNode } from "lexical";

import { ranked, type EditorExtension } from "../../core/extension.ts";
import { setBlock } from "../../shared/blocks.ts";

/** Paragraphs, headings and quotes, with typing, deleting and clipboard basics. */
export function richTextExtension(): EditorExtension {
	return {
		name: "rich-text",
		nodes: [HeadingNode, QuoteNode],
		markdown: ranked(50, HEADING, QUOTE),
		convertible: ["paragraph", "heading", "quote"],
		items: [
			{
				id: "paragraph",
				label: "Text",
				hint: "Plain paragraph",
				keywords: "text paragraph plain",
				order: 10,
				turnInto: true,
				apply: setBlock(() => $createParagraphNode()),
			},
			...([1, 2, 3] as const).map((level) => ({
				id: `h${level}`,
				label: `Heading ${level}`,
				hint: ["Big section heading", "Medium section heading", "Small section heading"][
					level - 1
				]!,
				keywords: ["h1 heading title", "h2 heading subtitle", "h3 heading"][level - 1]!,
				order: 10 + level * 10,
				turnInto: true,
				apply: setBlock(() => $createHeadingNode(`h${level}`)),
			})),
			{
				id: "quote",
				label: "Quote",
				hint: "Capture a quote",
				keywords: "quote blockquote citation",
				order: 90,
				turnInto: true,
				apply: setBlock(() => $createQuoteNode()),
			},
		],
		register: ({ editor }) => registerRichText(editor),
	};
}
