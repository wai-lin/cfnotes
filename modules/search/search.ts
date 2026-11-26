/** Quick-find: pages by title and text, or the items in Trash. */
import { Effect, Schema } from "effect";

import MainDb from "#space/db/main.ts";

import { likePattern, queryTerms, rankResults, snippet } from "./text.ts";

const MAX_RESULTS = 20;

export const Query = Schema.Struct({
	q: Schema.optional(Schema.String),
	in: Schema.optional(Schema.String),
});

interface Found {
	id: string;
	title: string;
	kind: string;
	icon: string | null;
	parent_title: string | null;
	archived_with?: string | null;
}

/**
 * `{results: [{id, title, kind, icon, parent, snippet, href}]}`. Every word
 * must appear in the title or body. With no query, the most recently edited.
 */
export const find = Effect.fn("Search.find")(function* (query: typeof Query.Type) {
	const terms = queryTerms((query.q ?? "").slice(0, 200));
	const inTrash = query.in === "trash";
	const shape = (row: Found) => ({
		id: row.id,
		title: row.title,
		kind: row.kind,
		icon: row.icon,
		parent: row.parent_title,
		// A trashed row of a trashed database is listed under its database.
		href: inTrash ? `/trash#trash-${row.archived_with ?? row.id}` : `/p/${row.id}`,
	});

	const [first] = terms;
	if (!first) {
		const recent = yield* inTrash ? MainDb.trash.listRecent() : MainDb.pages.listRecent();
		return { results: recent.map((row) => ({ ...shape(row), snippet: "" })) };
	}
	const pattern = likePattern(first);
	const rows = yield* inTrash ? MainDb.trash.search({ pattern }) : MainDb.pages.search({ pattern });
	const results = rankResults(rows, terms)
		.slice(0, MAX_RESULTS)
		.map((row) => ({ ...shape(row), snippet: snippet(row.body_text ?? "", terms) }));
	return { results };
});
