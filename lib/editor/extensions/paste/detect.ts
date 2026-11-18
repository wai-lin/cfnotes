/** Lines that start a markdown block: headings, lists, to-dos, quotes, fences, rules. */
const BLOCK =
	/^ {0,3}(?:#{1,6}\s+\S|[-*+]\s+\S|\d{1,9}[.)]\s+\S|>\s?|```|~~~|(?:-\s*){3,}$|(?:\*\s*){3,}$|(?:_\s*){3,}$)/;

/** A list marker: on its own line it reads as a sentence ("- see above"), not a document. */
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;

/** Inline markdown that plain prose rarely contains. */
const INLINE =
	/\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\)/;

/**
 * Whether pasted plain text is worth converting from markdown: unmistakable
 * inline markdown anywhere, or a block marker on some line (a lone list line
 * doesn't count). Ordinary prose and bare URLs stay plain text.
 */
export function looksLikeMarkdown(text: string): boolean {
	if (!text.trim() || text.length > 500_000) return false;
	if (INLINE.test(text)) return true;
	const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
	const blocks = lines.filter((line) => BLOCK.test(line));
	if (blocks.length === 0) return false;
	if (lines.length === 1) return !LIST_ITEM.test(lines[0] ?? "");
	return true;
}
