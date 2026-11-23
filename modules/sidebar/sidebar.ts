/** The sidebar's pages and folders, and every change the reader can make to them. */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, Conflict } from "spacefn";

import { Id } from "#lib/ids.ts";
import { placeBefore } from "#lib/order.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import { newDatabase } from "#modules/database/database.ts";
import * as Trash from "#modules/trash/trash.ts";
import MainDb from "#space/db/main.ts";

import { cleanFolderName, isWithin } from "./tree.ts";

/** A folder to put something in: `null`, empty or missing is the top level. */
const Target = Schema.optional(Schema.NullOr(Schema.String));

export const NewItem = Schema.Struct({ folder: Target });
export const NewFolder = Schema.Struct({ name: Schema.String, parentId: Target });
export const RenameFolder = Schema.Struct({ id: Id, name: Schema.String });
export const FolderRef = Schema.Struct({ id: Id });
export const FolderUndo = Schema.Struct({
	id: Id,
	name: Schema.String,
	parentId: Target,
	pages: Schema.Array(Id),
	folders: Schema.Array(Id),
});
export const Move = Schema.Struct({
	kind: Schema.Literals(["page", "folder"]),
	id: Id,
	folderId: Target,
});
export const Reorder = Schema.Struct({ id: Id, folderId: Target, beforeId: Target });
export const PageRef = Schema.Struct({ id: Id });
export const RestorePage = Schema.Struct({ id: Id, keepHost: Schema.optional(Schema.Boolean) });

const bad = (message: string) => new BadRequest({ message });

export const tree = Effect.all({ pages: MainDb.listPages(), folders: MainDb.listFolders() });

/** Everything the shell around a page shows. */
export const workspace = Effect.all({
	pages: MainDb.listPages(),
	folders: MainDb.listFolders(),
	index: MainDb.listIndexPages(),
});

const folderTarget = Effect.fn("Sidebar.folderTarget")(function* (
	value: string | null | undefined,
) {
	const folders = yield* MainDb.listFolders();
	if (!value) return { id: null, folders };
	if (!folders.some((folder) => folder.id === value)) return yield* bad("No such folder");
	return { id: value, folders };
});

const folderName = Effect.fn("Sidebar.folderName")(function* (value: string) {
	const name = cleanFolderName(value);
	if (!name) return yield* bad("A folder needs a name");
	return name;
});

/** For the "New" buttons, where a folder that's gone means the top level. */
const folderOrTop = (value: string | null | undefined) =>
	Effect.map(MainDb.listFolders(), (folders) =>
		value && folders.some((folder) => folder.id === value) ? value : null,
	);

export const createPage = Effect.fn("Sidebar.createPage")(function* ({
	folder,
}: typeof NewItem.Type) {
	const id = crypto.randomUUID();
	const folderId = yield* folderOrTop(folder);
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.createPage({ id, folderId, title: "", now, by: yield* Sessions.editor });
	return id;
});

export const createDatabase = Effect.fn("Sidebar.createDatabase")(function* ({
	folder,
}: typeof NewItem.Type) {
	return yield* newDatabase({
		folderId: yield* folderOrTop(folder),
		hostId: null,
		by: yield* Sessions.editor,
	});
});

/** `/` opens the first page, creating one in a fresh workspace. */
export const firstPage = Effect.gen(function* () {
	const [first] = yield* MainDb.listPages();
	if (first) return first.id;
	const id = crypto.randomUUID();
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.createPage({
		id,
		folderId: null,
		title: "Getting started",
		now,
		by: yield* Sessions.editor,
	});
	return id;
});

export const newFolder = Effect.fn("Sidebar.newFolder")(function* (input: typeof NewFolder.Type) {
	const name = yield* folderName(input.name);
	const parent = yield* folderTarget(input.parentId);
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.createFolder({ id: crypto.randomUUID(), parentId: parent.id, name, now });
});

export const renameFolder = Effect.fn("Sidebar.renameFolder")(function* (
	input: typeof RenameFolder.Type,
) {
	const name = yield* folderName(input.name);
	yield* folderTarget(input.id);
	yield* MainDb.renameFolder({ id: input.id, name });
});

/** Its pages and subfolders move up one level. Returns what `restoreFolder` needs. */
export const deleteFolder = Effect.fn("Sidebar.deleteFolder")(function* ({
	id,
}: typeof FolderRef.Type) {
	const { folders } = yield* folderTarget(id);
	const folder = folders.find((f) => f.id === id)!;
	const parentId = folder.parent_id;
	const undo: typeof FolderUndo.Type = {
		id,
		name: folder.name,
		parentId,
		pages: (yield* MainDb.listFolderPageIds({ id })).map((row) => row.id),
		folders: folders.filter((f) => f.parent_id === id).map((f) => f.id),
	};
	yield* MainDb.releaseFolderPages({ id, parentId });
	yield* MainDb.releaseFolderChildren({ id, parentId });
	yield* MainDb.deleteFolder({ id });
	return undo;
});

/** The folder again, with what was in it (unless moved since). */
export const restoreFolder = Effect.fn("Sidebar.restoreFolder")(function* (
	input: typeof FolderUndo.Type,
) {
	const { id } = input;
	const name = yield* folderName(input.name);
	const parent = yield* folderTarget(input.parentId);
	if (parent.folders.some((f) => f.id === id))
		return yield* new Conflict({ message: "That folder is already back" });
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.createFolder({ id, parentId: parent.id, name, now });
	const parentId = parent.id;
	yield* MainDb.returnPagesToFolder({ id, ids: JSON.stringify(input.pages), parentId });
	yield* MainDb.returnFoldersToFolder({ id, ids: JSON.stringify(input.folders), parentId });
});

export const move = Effect.fn("Sidebar.move")(function* ({ kind, id, folderId }: typeof Move.Type) {
	const target = yield* folderTarget(folderId);
	if (kind === "page") {
		if (Option.isNone(yield* MainDb.findPage({ id }))) return yield* bad("No such page");
		yield* MainDb.movePage({ id, folderId: target.id });
		return;
	}
	if (!target.folders.some((folder) => folder.id === id)) return yield* bad("No such folder");
	// A folder can't go inside itself or one of its own subfolders.
	if (isWithin(target.folders, target.id, id)) return yield* bad("A folder can't go inside itself");
	yield* MainDb.moveFolder({ id, parentId: target.id });
});

/** Puts a page in a folder just before `beforeId` (`null` = at the end), and renumbers the folder. */
export const reorder = Effect.fn("Sidebar.reorder")(function* ({
	id,
	folderId,
	beforeId,
}: typeof Reorder.Type) {
	const target = yield* folderTarget(folderId);
	const pages = yield* MainDb.listPages();
	const page = pages.find((row) => row.id === id);
	if (!page) return yield* bad("No such page");
	const siblings = pages.filter((row) => row.folder_id === target.id).map((row) => row.id);
	const order = placeBefore(siblings, id, beforeId ?? null);
	if (!order) return yield* bad("No such place");
	if (page.folder_id !== target.id) yield* MainDb.movePage({ id, folderId: target.id });
	yield* MainDb.setPageOrder({ ids: JSON.stringify(order) });
});

export const removePage = Effect.fn("Sidebar.removePage")(function* ({ id }: typeof PageRef.Type) {
	if (Option.isNone(yield* MainDb.findPage({ id }))) return yield* bad("No such page");
	yield* Trash.remove(id);
});

export const restorePage = Effect.fn("Sidebar.restorePage")(function* ({
	id,
	keepHost = false,
}: typeof RestorePage.Type) {
	const result = yield* Trash.restore(id, { keepHost });
	if (!result.ok) return yield* new Conflict({ message: Trash.RESTORE_ERRORS[result.error] });
});
