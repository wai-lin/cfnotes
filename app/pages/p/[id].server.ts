import { removePage } from "@modules/archive";
import { databaseState, runDatabaseOp } from "@modules/database/server";
import { patchElements, patchSignals, readSignals, sse } from "@modules/datastar";
import { database, isPageId, MAX_CONTENT_BYTES, MAX_TITLE_LENGTH } from "@modules/db";
import { pageLinksIn } from "@modules/links";
import { plainText } from "@modules/search";
import {
	addPageLinks,
	clearPageLinks,
	createPage,
	findDatabase,
	findPage,
	listBacklinks,
	listFolders,
	listIndexPages,
	listPages,
	setPageCover,
	setPageIcon,
	updatePageContent,
	updatePageTitle,
} from "@space/db/main_db";
import { defineActions, defineLoader } from "spacefn/pages";

import { navLink } from "../_shell";
import { sidebarActions, treeResponse } from "../_sidebar";

export const loader = defineLoader(async (c) => {
	const id = c.req.param("id");
	if (!isPageId(id)) return c.notFound();

	const db = await database(c.env.DB);
	const page = await findPage(db, { id });
	if (!page) return c.notFound();
	if (page.archived_at !== null) return c.redirect("/trash", 302);

	const [pages, folders, backlinks, index] = await Promise.all([
		listPages(db, {}),
		listFolders(db, {}),
		listBacklinks(db, { id }),
		listIndexPages(db, {}),
	]);
	// A row links back to its database; a full-page database is drawn from its state.
	const parent = page.database_id
		? ((await findDatabase(db, { id: page.database_id })) ?? null)
		: null;
	const table = page.kind === "database" ? await databaseState(db, id) : null;
	return { page, pages, folders, backlinks, index, parent, table };
});

async function pageFor(c: {
	env: { DB: D1Database };
	req: { param(name: string): string | undefined };
}) {
	const id = c.req.param("id");
	if (!isPageId(id)) return null;
	const db = await database(c.env.DB);
	const page = await findPage(db, { id });
	return page && page.archived_at === null ? { db, id, page } : null;
}

export const actions = defineActions({
	...sidebarActions,

	/**
	 * Editor page picker: `{title}` → a new page next to this one (same folder).
	 * Responds with `{id, title, tree}`; the client links to it and swaps `tree` into the sidebar.
	 */
	linkPage: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.json({ error: "not_found" }, 404);
		const body = await readSignals(c.req);
		const title =
			typeof body.title === "string"
				? body.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH)
				: "";
		const pages = await listPages(found.db, {});
		const folderId = pages.find((row) => row.id === found.id)?.folder_id ?? null;
		const id = crypto.randomUUID();
		await createPage(found.db, { id, folderId, title, now: Date.now() });
		const tree = await treeResponse(found.db, found.id);
		return c.json({ id, title, tree: await tree.text() });
	},

	/** Datastar: rename, then patch the sidebar link. The tab title follows `$title` in the page. */
	title: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.json({ error: "not_found" }, 404);

		const { title } = await readSignals(c.req);
		if (typeof title !== "string") return c.json({ error: "invalid_title" }, 400);
		const clean = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);

		await updatePageTitle(found.db, { id: found.id, title: clean, now: Date.now() });
		// Rows and inline databases aren't in the sidebar, so there's no link to patch.
		const inSidebar = !found.page.database_id && !found.page.host_id;
		return inSidebar
			? sse(
					patchElements(
						navLink(
							{ id: found.id, title: clean, kind: found.page.kind, icon: found.page.icon },
							found.id,
						),
					),
				)
			: sse();
	},

	/** `{icon}` (an emoji; empty clears it). Patches the sidebar link. */
	icon: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.json({ error: "not_found" }, 404);
		const { icon } = await readSignals(c.req);
		const clean = typeof icon === "string" ? icon.trim().slice(0, 32) : "";
		await setPageIcon(found.db, { id: found.id, icon: clean || null, now: Date.now() });
		const inSidebar = !found.page.database_id && !found.page.host_id;
		if (!inSidebar) return c.json({ ok: true });
		return c.json({
			ok: true,
			nav: navLink(
				{ id: found.id, title: found.page.title, kind: found.page.kind, icon: clean || null },
				found.id,
			).value,
		});
	},

	/** `{cover}`: a preset id (`g1`…`g6`), an uploaded image path, or empty to clear. */
	cover: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.json({ error: "not_found" }, 404);
		const { cover } = await readSignals(c.req);
		let clean: string | null = null;
		if (typeof cover === "string") {
			if (/^g[1-6]$/.test(cover)) clean = cover;
			else if (/^\/files\/img\/[\w.-]+$/.test(cover)) clean = cover;
			else if (cover !== "") return c.json({ error: "invalid_cover" }, 400);
		}
		await setPageCover(found.db, { id: found.id, cover: clean, now: Date.now() });
		return c.json({ ok: true, cover: clean });
	},

	/** Datastar: store the serialized Lexical editor state. */
	save: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.json({ error: "not_found" }, 404);

		const { doc } = await readSignals(c.req);
		if (typeof doc !== "string" || doc.length === 0) {
			return c.json({ error: "invalid_doc" }, 400);
		}
		if (new TextEncoder().encode(doc).byteLength > MAX_CONTENT_BYTES) {
			return c.json({ error: "doc_too_large" }, 413);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(doc);
			if (!parsed || typeof parsed !== "object" || !("root" in parsed)) throw new Error("no root");
		} catch {
			return c.json({ error: "invalid_doc" }, 400);
		}

		await updatePageContent(found.db, {
			id: found.id,
			content: doc,
			bodyText: plainText(parsed),
			now: Date.now(),
		});
		// Keep the backlink index in step with the document.
		await clearPageLinks(found.db, { id: found.id });
		const links = pageLinksIn(parsed, found.id);
		if (links.length > 0)
			await addPageLinks(found.db, { id: found.id, ids: JSON.stringify(links) });
		return sse(patchSignals({ _saving: false, _savedAt: Date.now() }));
	},

	/** Plain form post: delete this page and go back to its database, host page or the workspace. */
	remove: async (c) => {
		const found = await pageFor(c);
		if (!found) return c.redirect("/", 303);
		await removePage(found.db, found.id);
		const back = found.page.database_id ?? found.page.host_id;
		// It went to Trash: the next page says so and offers Undo.
		const query = `?${new URLSearchParams({ trashed: found.id, title: found.page.title })}`;
		return c.redirect(`${back ? `/p/${back}` : "/"}${query}`, 303);
	},

	/** Table UI: `{op, databaseId, …}` → `{state}`. See `modules/database/server.ts`. */
	dbOp: async (c) => {
		const id = c.req.param("id");
		if (!isPageId(id)) return c.json({ error: "not_found" }, 404);
		const db = await database(c.env.DB);
		return runDatabaseOp(db, id, await readSignals(c.req));
	},
});
