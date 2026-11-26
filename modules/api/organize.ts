/**
 * Where pages live, for the MCP server: moving pages between folders and
 * ordering them, making, renaming, moving and deleting folders, and Trash.
 * Each goes through the sidebar's and Trash's own functions.
 */
import { Effect, Option, Schema } from "effect";
import { BadRequest, NotFound } from "spacefn";

import { isId } from "#lib/ids.ts";
import * as Sidebar from "#modules/sidebar/sidebar.ts";
import * as Trash from "#modules/trash/trash.ts";
import MainDb from "#space/db/main.ts";

import { listFolders, livePage } from "./api.ts";

const bad = (message: string) => new BadRequest({ message });
const iso = (ms: number) => new Date(ms).toISOString();

/** A folder by id, or a 404. */
const folder = Effect.fn("Organize.folder")(function* (id: string) {
	const found = (yield* listFolders).find((f) => f.id === id);
	if (!found) return yield* new NotFound({ message: "No such folder" });
	return found;
});

export const MovePage = Schema.Struct({
	page_id: Schema.String,
	/** The folder it goes in; `null` is the top level. Unset: where it is. */
	folder_id: Schema.optional(Schema.NullOr(Schema.String)),
	/** A page in that folder to put it just before; `null` (or unset) puts it last. */
	before_page_id: Schema.optional(Schema.NullOr(Schema.String)),
});

/** Moves a sidebar page (or full-page database) to a folder, and to a place in it. */
export const movePage = Effect.fn("Organize.movePage")(function* (input: unknown) {
	const spec = yield* Schema.decodeUnknownEffect(MovePage)(input);
	const page = yield* livePage(spec.page_id);
	if (page.database_id) return yield* bad("A row lives in its database; it can't go in a folder");
	if (page.host_id)
		return yield* bad("An inline database lives in its page; it can't go in a folder");
	const folderId = spec.folder_id === undefined ? page.folder_id : spec.folder_id;
	if (folderId) yield* folder(folderId);
	if (spec.before_page_id) {
		const before = yield* livePage(spec.before_page_id);
		if (before.folder_id !== folderId || before.database_id || before.host_id)
			return yield* bad("before_page_id has to be a page in the same folder");
	}
	yield* Sidebar.reorder({ id: page.id, folderId, beforeId: spec.before_page_id ?? null });
	return { id: page.id, folder: folderId ? yield* folder(folderId) : null };
});

export const createFolder = Effect.fn("Organize.createFolder")(function* (
	name: string,
	parentId: string | null,
) {
	if (parentId) yield* folder(parentId);
	return yield* folder(yield* Sidebar.newFolder({ name, parentId }));
});

/** Renames a folder and moves it under another (or to the top level: `null`). */
export const updateFolder = Effect.fn("Organize.updateFolder")(function* (
	id: string,
	changes: { name?: string | undefined; parentId?: string | null | undefined },
) {
	yield* folder(id);
	if (changes.parentId) yield* folder(changes.parentId);
	if (changes.name !== undefined) yield* Sidebar.renameFolder({ id, name: changes.name });
	if (changes.parentId !== undefined)
		yield* Sidebar.move({ kind: "folder", id, folderId: changes.parentId });
	return yield* folder(id);
});

/** Deletes a folder; what's in it moves up a level, so nothing goes to Trash. */
export const deleteFolder = Effect.fn("Organize.deleteFolder")(function* (id: string) {
	const found = yield* folder(id);
	const undo = yield* Sidebar.deleteFolder({ id });
	return { folder: found, movedUp: { pages: undo.pages.length, folders: undo.folders.length } };
});

/** What's in Trash: each thing deleted (with how much went with it), newest first. */
export const listTrash = Effect.gen(function* () {
	const { items } = yield* Trash.list;
	return items.map((item) => ({
		id: item.id,
		title: item.title,
		kind: item.kind === "database" ? "database" : item.database_id ? "row" : "page",
		...(item.database_id ? { database: { id: item.database_id, title: item.database_title } } : {}),
		trashedAt: iso(item.archived_at ?? 0),
		deletedForGoodAt: iso(item.purgeAt),
		// The rows and inline databases that went with it, which come back with it.
		with: Math.max(0, item.items - 1),
	}));
});

/** Brings back something from Trash, with what went with it. */
export const restorePage = Effect.fn("Organize.restorePage")(function* (id: string) {
	if (!isId(id)) return yield* new NotFound({ message: "No such page" });
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page) return yield* new NotFound({ message: "No such page" });
	if (page.archived_at !== null && page.archived_with !== id)
		return yield* bad(
			"It went to Trash with something else (a database or the page holding it): restore that, see list_trash",
		);
	const result = yield* Trash.restore(id);
	if (!result.ok) return yield* bad(Trash.RESTORE_ERRORS[result.error]);
	return id;
});
