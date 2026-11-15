import { purge, purgeAt, restore } from "@modules/archive";
import { database, isPageId } from "@modules/db";
import { listArchive, listFolders, listIndexPages, listPages } from "@space/db/main_db";
import { defineActions, defineLoader } from "spacefn/pages";

import { sidebarActions } from "./_sidebar";

export const loader = defineLoader(async (c) => {
	const db = await database(c.env.DB);
	const [pages, folders, index, archived] = await Promise.all([
		listPages(db, {}),
		listFolders(db, {}),
		listIndexPages(db, {}),
		listArchive(db, {}),
	]);
	const items = archived.map((item) => ({
		...item,
		purgeAt: purgeAt(item.archived_at ?? Date.now()),
	}));
	return { pages, folders, index, items, notice: c.req.query("notice") ?? null };
});

/** The id posted by an item's form, if it's a valid page id. */
async function postedId(c: { req: { parseBody(): Promise<Record<string, unknown>> } }) {
	const body = await c.req.parseBody();
	return typeof body.id === "string" && isPageId(body.id) ? body.id : null;
}

export const actions = defineActions({
	...sidebarActions,

	/** Brings an item back and opens it. */
	restore: async (c) => {
		const id = await postedId(c);
		if (!id) return c.redirect("/trash", 303);
		const result = await restore(await database(c.env.DB), id);
		return c.redirect(result.ok ? `/p/${result.id}` : `/trash?notice=${result.error}`, 303);
	},

	/** Deletes one item (and what went with it) for good. */
	purge: async (c) => {
		const id = await postedId(c);
		if (id) await purge(await database(c.env.DB), [id]);
		return c.redirect("/trash", 303);
	},

	/** Deletes everything in Trash for good. */
	empty: async (c) => {
		const db = await database(c.env.DB);
		const all = await listArchive(db, {});
		await purge(
			db,
			all.map((item) => item.id),
		);
		return c.redirect("/trash", 303);
	},
});
