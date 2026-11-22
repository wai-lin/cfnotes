/**
 * Full-text search helpers: what text a page is searched by, how a query
 * matches it, and the snippet shown under a result. Pure functions; the
 * `pages.body_text` column holds `plainText(doc)`, kept in step on save.
 */

/** Lexical node types that flow inside a line (joined without a space). */
const INLINE = new Set(["text", "link", "autolink", "page-link", "code-highlight", "tab"]);

/** Longest body text stored per page; enough for search and snippets. */
export const MAX_BODY_TEXT = 100_000;

/** The searchable text of a serialized editor state: words in reading order, single-spaced. */
export function plainText(state: unknown): string {
	const root = state && typeof state === "object" ? (state as { root?: unknown }).root : null;
	const walk = (node: unknown): string => {
		if (!node || typeof node !== "object") return "";
		const n = node as Record<string, unknown>;
		if (n.type === "linebreak") return " ";
		if (n.type === "image") return ` ${typeof n.caption === "string" ? n.caption : ""} `;
		if (n.type === "file") return ` ${typeof n.name === "string" ? n.name : ""} `;
		if (n.type === "equation") return ` ${typeof n.equation === "string" ? n.equation : ""} `;
		if (n.type === "embed") {
			const preview = (n.preview ?? {}) as Record<string, unknown>;
			const words = [preview.title, preview.description, n.url].filter(
				(w) => typeof w === "string",
			);
			return ` ${words.join(" ")} `;
		}
		if (typeof n.text === "string") return n.text;
		const inner = Array.isArray(n.children) ? n.children.map(walk).join("") : "";
		return INLINE.has(String(n.type)) ? inner : ` ${inner} `;
	};
	return walk(root).replace(/\s+/g, " ").trim().slice(0, MAX_BODY_TEXT);
}

/** The query's words, lowercased, longest first (the first narrows the SQL scan). */
export function queryTerms(query: string): string[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
	return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** A `LIKE … ESCAPE '\'` pattern matching `term` anywhere. */
export function likePattern(term: string): string {
	return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface SearchRow {
	id: string;
	title: string;
	body_text: string | null;
	updated_at: number;
}

/**
 * Ranks rows that contain every term (in the title or body): all terms in the
 * title first, then some in the title, then body-only; newest first within each.
 */
export function rankResults<T extends SearchRow>(rows: readonly T[], terms: string[]): T[] {
	const scored: { row: T; score: number }[] = [];
	for (const row of rows) {
		const title = row.title.toLowerCase();
		const body = (row.body_text ?? "").toLowerCase();
		if (!terms.every((t) => title.includes(t) || body.includes(t))) continue;
		const inTitle = terms.filter((t) => title.includes(t)).length;
		scored.push({ row, score: inTitle === terms.length ? 2 : inTitle > 0 ? 1 : 0 });
	}
	return scored
		.sort((a, b) => b.score - a.score || b.row.updated_at - a.row.updated_at)
		.map((s) => s.row);
}

/**
 * About `width` characters of `text` around the first term found, with an
 * ellipsis where it was cut. Empty when no term is in the text.
 */
export function snippet(text: string, terms: string[], width = 120): string {
	const lower = text.toLowerCase();
	let at = -1;
	for (const term of terms) {
		const i = lower.indexOf(term);
		if (i >= 0 && (at < 0 || i < at)) at = i;
	}
	if (at < 0) return "";
	let start = Math.max(0, at - Math.floor(width / 3));
	// Start on a word boundary when cutting into the text.
	if (start > 0) {
		const space = text.indexOf(" ", start);
		if (space >= 0 && space < at) start = space + 1;
	}
	const end = Math.min(text.length, start + width);
	return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
