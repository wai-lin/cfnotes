/** The sidebar's pages and folders, and every change the reader can make to them. */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, Conflict, Forbidden } from "spacefn";

import { Id } from "#lib/ids.ts";
import { placeBefore } from "#lib/order.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import { newDatabase } from "#modules/database/database.ts";
import * as Sharing from "#modules/sharing/sharing.ts";
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

/** Everything the shell around a page shows. */
export const workspace = Effect.all({
	pages: MainDb.pages.list(),
	folders: MainDb.folders.list(),
	index: MainDb.pages.listIndex(),
});

const folderTarget = Effect.fn("Sidebar.folderTarget")(function* (
	value: string | null | undefined,
) {
	const folders = yield* MainDb.folders.list();
	if (!value) return { id: null, folders };
	if (!folders.some((folder) => folder.id === value)) return yield* bad("No such folder");
	return { id: value, folders };
});

const folderName = Effect.fn("Sidebar.folderName")(function* (value: string) {
	const name = cleanFolderName(value);
	if (!name) return yield* bad("A folder needs a name");
	return name;
});

/**
 * Where the "New" buttons put something: for an owner, a folder that's gone
 * means the top level; a friend adds only to a folder they may edit.
 */
const folderOrTop = Effect.fn("Sidebar.folderOrTop")(function* (value: string | null | undefined) {
	if (!(yield* Sharing.me)?.owner) {
		yield* Sharing.requireFolder(value || null);
		return value || null;
	}
	const folders = yield* MainDb.folders.list();
	return value && folders.some((folder) => folder.id === value) ? value : null;
});

export const createPage = Effect.fn("Sidebar.createPage")(function* ({
	folder,
}: typeof NewItem.Type) {
	const id = crypto.randomUUID();
	const folderId = yield* folderOrTop(folder);
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.pages.create({ id, folderId, title: "", now, by: yield* Sessions.editor });
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

/**
 * `/` opens the first page, creating one in a fresh workspace. A friend gets
 * the first page shared with them, or `null` while there's none.
 */
export const firstPage = Effect.gen(function* () {
	if (!(yield* Sharing.me)?.owner) return yield* Sharing.firstShared;
	const [first] = yield* MainDb.pages.list();
	if (first) return first.id;
	const id = crypto.randomUUID();
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.pages.create({
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
	yield* Sharing.requireFolder(input.parentId || null);
	const parent = yield* folderTarget(input.parentId);
	const now = yield* Clock.currentTimeMillis;
	const id = crypto.randomUUID();
	yield* MainDb.folders.create({ id, parentId: parent.id, name, now });
	return id;
});

export const renameFolder = Effect.fn("Sidebar.renameFolder")(function* (
	input: typeof RenameFolder.Type,
) {
	const name = yield* folderName(input.name);
	yield* Sharing.requireFolder(input.id);
	yield* folderTarget(input.id);
	yield* MainDb.folders.rename({ id: input.id, name });
});

/** Its pages and subfolders move up one level. Returns what `restoreFolder` needs. */
export const deleteFolder = Effect.fn("Sidebar.deleteFolder")(function* ({
	id,
}: typeof FolderRef.Type) {
	// It goes, and what's in it moves out of it: an edit of it (so not when it's locked).
	yield* Sharing.requireFolder(id);
	const { folders } = yield* folderTarget(id);
	const folder = folders.find((f) => f.id === id)!;
	const parentId = folder.parent_id;
	// What's in it moves up into its parent, which takes an edit of that.
	yield* mayLeave(parentId);
	const undo: typeof FolderUndo.Type = {
		id,
		name: folder.name,
		parentId,
		pages: (yield* MainDb.folders.listPageIds({ id })).map((row) => row.id),
		folders: folders.filter((f) => f.parent_id === id).map((f) => f.id),
	};
	yield* MainDb.folders.releasePages({ id, parentId });
	yield* MainDb.folders.releaseChildren({ id, parentId });
	// What was shared through it isn't any more (and Undo doesn't share it again).
	yield* MainDb.shares.forgetFolder({ id });
	yield* MainDb.folders.delete({ id });
	return undo;
});

/** The folder again, with what was in it (unless moved since). */
export const restoreFolder = Effect.fn("Sidebar.restoreFolder")(function* (
	input: typeof FolderUndo.Type,
) {
	const { id } = input;
	const name = yield* folderName(input.name);
	yield* Sharing.requireFolder(input.parentId || null);
	const parent = yield* folderTarget(input.parentId);
	if (parent.folders.some((f) => f.id === id))
		return yield* new Conflict({ message: "That folder is already back" });
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.folders.create({ id, parentId: parent.id, name, now });
	const parentId = parent.id;
	yield* MainDb.folders.returnPages({ id, ids: JSON.stringify(input.pages), parentId });
	yield* MainDb.folders.returnFolders({ id, ids: JSON.stringify(input.folders), parentId });
});

/** Fails unless the signed-in person may take a folder out of `parentId` (or the top level). */
const mayLeave = (parentId: string | null) =>
	Sharing.requireFolder(parentId).pipe(
		Effect.catchTag("NotFound", () =>
			Effect.fail(
				new Forbidden({ message: "That folder is shared with you: it stays where it is" }),
			),
		),
	);

/** A page the signed-in person may see, and may take out of where it is. */
const movablePage = Effect.fn("Sidebar.movablePage")(function* (id: string) {
	yield* Sharing.requireAccess(id, "view");
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page) return yield* bad("No such page");
	yield* Sharing.requireHome(page);
	return page;
});

export const move = Effect.fn("Sidebar.move")(function* ({ kind, id, folderId }: typeof Move.Type) {
	yield* Sharing.requireFolder(folderId || null);
	const target = yield* folderTarget(folderId);
	if (kind === "page") {
		yield* movablePage(id);
		yield* MainDb.pages.move({ id, folderId: target.id });
		return;
	}
	yield* Sharing.requireFolder(id);
	if (!target.folders.some((folder) => folder.id === id)) return yield* bad("No such folder");
	yield* mayLeave(target.folders.find((folder) => folder.id === id)!.parent_id);
	// A folder can't go inside itself or one of its own subfolders.
	if (isWithin(target.folders, target.id, id)) return yield* bad("A folder can't go inside itself");
	yield* MainDb.folders.move({ id, parentId: target.id });
});

/** Puts a page in a folder just before `beforeId` (`null` = at the end), and renumbers the folder. */
export const reorder = Effect.fn("Sidebar.reorder")(function* ({
	id,
	folderId,
	beforeId,
}: typeof Reorder.Type) {
	yield* Sharing.requireFolder(folderId || null);
	const target = yield* folderTarget(folderId);
	yield* movablePage(id);
	const pages = yield* MainDb.pages.list();
	const page = pages.find((row) => row.id === id);
	if (!page) return yield* bad("No such page");
	const siblings = pages.filter((row) => row.folder_id === target.id).map((row) => row.id);
	const order = placeBefore(siblings, id, beforeId ?? null);
	if (!order) return yield* bad("No such place");
	if (page.folder_id !== target.id) yield* MainDb.pages.move({ id, folderId: target.id });
	yield* MainDb.pages.setOrder({ ids: JSON.stringify(order) });
});

export const removePage = Effect.fn("Sidebar.removePage")(function* ({ id }: typeof PageRef.Type) {
	yield* movablePage(id);
	yield* Trash.remove(id);
});

export const restorePage = Effect.fn("Sidebar.restorePage")(function* ({
	id,
	keepHost = false,
}: typeof RestorePage.Type) {
	// A friend brings back what they could have put there: see `Sharing.requireHome`.
	if (!(yield* Sharing.me)?.owner) yield* movablePage(id);
	const result = yield* Trash.restore(id, { keepHost });
	if (!result.ok) return yield* new Conflict({ message: Trash.RESTORE_ERRORS[result.error] });
});
