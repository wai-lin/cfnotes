import { database } from "@modules/db";
import { likePattern, queryTerms, rankResults, snippet } from "@modules/search";
import { listRecentPages, listRecentTrash, searchPages, searchTrash } from "@space/db/main_db";
import { defineHandler } from "spacefn/handler";

const MAX_RESULTS = 20;

/**
 * Quick-find: `?q=` → `{results: [{id, title, kind, icon, parent, snippet, href}]}`.
 * Every word must appear in the title or body. With no query, the most
 * recently edited pages. Only pages not in Trash; with `&in=trash`, only the
 * ones in Trash, each linking to its item on the Trash page.
 */
export const GET = defineHandler(async (c) => {
	const db = await database(c.env.DB);
	const terms = queryTerms((c.req.query("q") ?? "").slice(0, 200));
	const inTrash = c.req.query("in") === "trash";

	const shape = (row: {
		id: string;
		title: string;
		kind: string;
		icon: string | null;
		parent_title: string | null;
		archived_with?: string | null;
	}) => ({
		id: row.id,
		title: row.title,
		kind: row.kind,
		icon: row.icon ?? null,
		parent: row.parent_title ?? null,
		// A trashed row of a trashed database is listed under its database.
		href: inTrash ? `/trash#trash-${row.archived_with ?? row.id}` : `/p/${row.id}`,
	});

	const [first] = terms;
	if (!first) {
		const recent = await (inTrash ? listRecentTrash(db, {}) : listRecentPages(db, {}));
		return c.json({ results: recent.map((row) => ({ ...shape(row), snippet: "" })) }, 200, {
			"cache-control": "no-store",
		});
	}

	const pattern = likePattern(first);
	const rows = await (inTrash ? searchTrash(db, { pattern }) : searchPages(db, { pattern }));
	const results = rankResults(rows, terms)
		.slice(0, MAX_RESULTS)
		.map((row) => ({ ...shape(row), snippet: snippet(row.body_text ?? "", terms) }));
	return c.json({ results }, 200, { "cache-control": "no-store" });
});
