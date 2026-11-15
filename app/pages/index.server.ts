import { database } from "@modules/db";
import { createPage, listPages } from "@space/db/main_db";
import { defineLoader } from "spacefn/pages";

/** `/` opens the first page, creating one on a fresh workspace. */
export const loader = defineLoader(async (c) => {
	const db = await database(c.env.DB);
	const [first] = await listPages(db, {});
	// Keep the query: a redirect here after trashing carries the toast's details.
	const query = new URL(c.req.url).search;
	if (first) return c.redirect(`/p/${first.id}${query}`, 302);

	const id = crypto.randomUUID();
	await createPage(db, { id, folderId: null, title: "Getting started", now: Date.now() });
	return c.redirect(`/p/${id}`, 302);
});
