/**
 * Sidebar actions, shared by every page that shows the sidebar (spread them
 * into the page's `defineActions`). Tree actions answer with the re-rendered
 * tree, which the client swaps into `#page-nav`.
 */
import { removePage, restore } from "@modules/archive";
import { newDatabase } from "@modules/database/server";
import { readSignals } from "@modules/datastar";
import { database, isPageId } from "@modules/db";
import { cleanFolderName, isWithin, placePage } from "@modules/tree";
import {
	createFolder,
	createPage,
	deleteFolder,
	findPage,
	listFolderPageIds,
	listFolders,
	listPages,
	moveFolder,
	movePage,
	releaseFolderChildren,
	releaseFolderPages,
	renameFolder,
	returnFoldersToFolder,
	returnPagesToFolder,
	setPageOrder,
} from "@space/db/main_db";
import type { PageAction } from "spacefn/pages";

import { navItems } from "./_shell";

type Db = Awaited<ReturnType<typeof database>>;

/** Answers a sidebar action with the re-rendered tree (the client swaps it into `#page-nav`). */
export async function treeResponse(db: Db, activeId: string | undefined): Promise<Response> {
	const [pages, folders] = await Promise.all([listPages(db, {}), listFolders(db, {})]);
	return new Response(navItems(folders, pages, activeId).value, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

/** A folder id from an untrusted body: `null` for top level, `undefined` when invalid or missing. */
async function folderTarget(db: Db, value: unknown) {
	if (value === null || value === "" || value === undefined)
		return { id: null, folders: await listFolders(db, {}) };
	if (typeof value !== "string" || !isPageId(value)) return undefined;
	const folders = await listFolders(db, {});
	return folders.some((folder) => folder.id === value) ? { id: value, folders } : undefined;
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

export const sidebarActions = {
	/** Plain form post from the sidebar: create a page (optionally in a folder) and open it. */
	create: async (c) => {
		const db = await database(c.env.DB);
		const body = await c.req.parseBody();
		const target = await folderTarget(db, body.folder);
		const id = crypto.randomUUID();
		await createPage(db, { id, folderId: target?.id ?? null, title: "", now: Date.now() });
		return c.redirect(`/p/${id}`, 303);
	},

	/** Sidebar: `{name, parentId}` → new folder. Responds with the tree. */
	newFolder: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const name = cleanFolderName(body.name);
		const target = await folderTarget(db, body.parentId);
		if (!name) return bad("invalid_name");
		if (!target) return bad("invalid_parent");
		await createFolder(db, { id: crypto.randomUUID(), parentId: target.id, name, now: Date.now() });
		return treeResponse(db, c.req.param("id"));
	},

	/** Sidebar: `{id, name}` → rename a folder. */
	renameFolder: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const name = cleanFolderName(body.name);
		const target = await folderTarget(db, body.id);
		if (!name) return bad("invalid_name");
		if (!target?.id) return bad("invalid_folder");
		await renameFolder(db, { id: target.id, name });
		return treeResponse(db, c.req.param("id"));
	},

	/**
	 * Sidebar: `{id}` → delete a folder. Its pages and subfolders move up one
	 * level. The tree comes with an `x-undo` header: what `restoreFolder` needs.
	 */
	deleteFolder: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const target = await folderTarget(db, body.id);
		if (!target?.id) return bad("invalid_folder");
		const folder = target.folders.find((f) => f.id === target.id)!;
		const parentId = folder.parent_id ?? null;
		const undo = {
			id: folder.id,
			name: folder.name,
			parentId,
			pages: (await listFolderPageIds(db, { id: folder.id })).map((row) => row.id),
			folders: target.folders.filter((f) => f.parent_id === folder.id).map((f) => f.id),
		};
		await releaseFolderPages(db, { id: target.id, parentId });
		await releaseFolderChildren(db, { id: target.id, parentId });
		await deleteFolder(db, { id: target.id });
		const res = await treeResponse(db, c.req.param("id"));
		res.headers.set("x-undo", encodeURIComponent(JSON.stringify(undo)));
		return res;
	},

	/**
	 * Undo of a folder delete: `{id, name, parentId, pages, folders}` (from the
	 * delete's `x-undo`) → the folder again, with what was in it (unless moved since).
	 */
	restoreFolder: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const id = typeof body.id === "string" && isPageId(body.id) ? body.id : null;
		const name = cleanFolderName(body.name);
		const target = await folderTarget(db, body.parentId);
		const ids = (list: unknown) =>
			JSON.stringify(
				Array.isArray(list) ? list.filter((x) => typeof x === "string" && isPageId(x)) : [],
			);
		if (!id || !name || !target) return bad("invalid_folder");
		if (target.folders.some((f) => f.id === id)) return bad("exists");
		await createFolder(db, { id, parentId: target.id, name, now: Date.now() });
		await returnPagesToFolder(db, { id, ids: ids(body.pages), parentId: target.id });
		await returnFoldersToFolder(db, { id, ids: ids(body.folders), parentId: target.id });
		return treeResponse(db, c.req.param("id"));
	},

	/** Sidebar: `{kind: "page" | "folder", id, folderId}` → move into a folder (`null` = top level). */
	move: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const target = await folderTarget(db, body.folderId);
		if (!target) return bad("invalid_target");
		const id = typeof body.id === "string" && isPageId(body.id) ? body.id : null;
		if (!id) return bad("invalid_id");

		if (body.kind === "page") {
			if (!(await findPage(db, { id }))) return bad("invalid_id");
			await movePage(db, { id, folderId: target.id });
		} else if (body.kind === "folder") {
			if (!target.folders.some((folder) => folder.id === id)) return bad("invalid_id");
			// A folder can't go inside itself or one of its own subfolders.
			if (isWithin(target.folders, target.id, id)) return bad("invalid_target");
			await moveFolder(db, { id, parentId: target.id });
		} else {
			return bad("invalid_kind");
		}
		return treeResponse(db, c.req.param("id"));
	},

	/**
	 * Sidebar drag: `{id, folderId, beforeId}` → put the page in that folder,
	 * just before `beforeId` (`null` = at the end), and renumber the folder.
	 */
	reorder: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const target = await folderTarget(db, body.folderId);
		if (!target) return bad("invalid_target");
		const id = typeof body.id === "string" && isPageId(body.id) ? body.id : null;
		if (!id) return bad("invalid_id");
		const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
		if (body.beforeId != null && beforeId === null) return bad("invalid_before");

		const pages = await listPages(db, {});
		const page = pages.find((row) => row.id === id);
		if (!page) return bad("invalid_id");
		const siblings = pages.filter((row) => row.folder_id === target.id).map((row) => row.id);
		const order = placePage(siblings, id, beforeId);
		if (!order) return bad("invalid_before");

		if (page.folder_id !== target.id) await movePage(db, { id, folderId: target.id });
		await setPageOrder(db, { ids: JSON.stringify(order) });
		return treeResponse(db, c.req.param("id"));
	},

	/** Sidebar: `{id}` → move any page to Trash. Responds with the tree. */
	removePage: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const id = typeof body.id === "string" && isPageId(body.id) ? body.id : null;
		if (!id || !(await findPage(db, { id }))) return bad("invalid_id");
		await removePage(db, id);
		return treeResponse(db, c.req.param("id"));
	},

	/** Undo after moving to Trash: `{id, keepHost?}` → restored, answers with the tree (409 + `{error}` if it can't). */
	restorePage: async (c) => {
		const db = await database(c.env.DB);
		const body = await readSignals(c.req);
		const id = typeof body.id === "string" && isPageId(body.id) ? body.id : null;
		if (!id) return bad("invalid_id");
		const result = await restore(db, id, { keepHost: body.keepHost === true });
		if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
		return treeResponse(db, c.req.param("id"));
	},

	/** Plain form post from the sidebar: a full-page database (optionally in a folder). */
	createDatabase: async (c) => {
		const db = await database(c.env.DB);
		const body = await c.req.parseBody();
		const target = await folderTarget(db, body.folder);
		const id = await newDatabase(db, { folderId: target?.id ?? null, hostId: null });
		return c.redirect(`/p/${id}`, 303);
	},
} satisfies Record<string, PageAction>;
