/**
 * Removing pages. Whatever the reader deletes (a page, a database, a row) goes
 * to Trash with everything inside it: hidden, restorable as one item, and
 * deleted for good after `TRASH_DAYS`.
 */
import { Clock, Effect, Option, Schema } from "effect";

import { Id } from "#lib/ids.ts";
import * as Comments from "#modules/comments/comments.ts";
import MainDb from "#space/db/main.ts";

export const TRASH_DAYS = 30;
export const DAY = 24 * 60 * 60 * 1000;

/** Why an item couldn't be restored, as the reader is told. */
export const RESTORE_ERRORS = {
	database_archived: "That row's database is in Trash. Restore the database first.",
	not_archived: "That item isn't in Trash any more.",
};

export type RestoreError = keyof typeof RESTORE_ERRORS;
export type RestoreResult = { ok: true; id: string } | { ok: false; error: RestoreError };

export const TrashRef = Schema.Struct({ id: Id });

/** When something trashed at `archivedAt` is deleted for good. */
export const purgeAt = (archivedAt: number) => archivedAt + TRASH_DAYS * DAY;

/** `id` and everything inside it that isn't trashed yet: a database's rows, embedded databases, … */
const treeOf = Effect.fn("Trash.treeOf")(function* (id: string) {
	const ids = new Set([id]);
	let level = [id];
	while (level.length > 0 && ids.size < 20_000) {
		const owned = yield* MainDb.pages.listOwned({ ids: JSON.stringify(level) });
		level = owned.map((row) => row.id).filter((child) => !ids.has(child));
		for (const child of level) ids.add(child);
	}
	return [...ids];
});

/** Moves what the reader deleted to Trash, with its rows and inline databases, as one item. */
export const remove = Effect.fn("Trash.remove")(function* (id: string) {
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page || page.archived_at !== null) return;
	const ids = yield* treeOf(id);
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.pages.archive({ ids: JSON.stringify(ids), root: id, now });
});

/**
 * Brings back a trashed item and what went with it. A row needs its database
 * back first. An inline database whose page is gone (or no longer embeds it)
 * comes back as a full-page database in the sidebar, unless `keepHost` (Undo).
 */
export const restore = Effect.fn("Trash.restore")(function* (
	id: string,
	{ keepHost = false }: { keepHost?: boolean } = {},
) {
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page || page.archived_at === null || page.archived_with !== id)
		return { ok: false, error: "not_archived" } as RestoreResult;
	if (page.database_id && Option.isNone(yield* MainDb.databases.find({ id: page.database_id })))
		return { ok: false, error: "database_archived" } as RestoreResult;
	if (page.host_id) {
		const host = Option.getOrUndefined(yield* MainDb.pages.find({ id: page.host_id }));
		// Undo right after deleting an inline database puts its block back, so it
		// stays attached even if the page saved without it in between.
		const live = host?.archived_at === null;
		const embedded = live && (keepHost || (host.content ?? "").includes(id));
		if (!embedded) yield* MainDb.pages.detachHost({ id });
	}
	yield* MainDb.pages.restore({ root: id });
	return { ok: true, id } as RestoreResult;
});

/** Deletes trashed items (and what went with them) for good, with every link to or from them. */
export const purge = Effect.fn("Trash.purge")(function* (roots: readonly string[]) {
	if (roots.length === 0) return;
	const found = yield* MainDb.trash.listWith({ roots: JSON.stringify(roots) });
	if (found.length === 0) return;
	const ids = JSON.stringify(found.map((row) => row.id));
	yield* MainDb.links.forgetPages({ ids });
	yield* MainDb.relations.forgetPages({ ids });
	yield* Comments.forget(ids);
	yield* MainDb.shares.forgetPages({ ids });
	yield* MainDb.pages.delete({ ids });
});

export const empty = Effect.gen(function* () {
	const all = yield* MainDb.trash.list();
	yield* purge(all.map((item) => item.id));
});

/** Deletes what has been in Trash longer than `TRASH_DAYS`. Returns how many items. */
export const purgeExpired = Effect.gen(function* () {
	const before = (yield* Clock.currentTimeMillis) - TRASH_DAYS * DAY;
	const expired = yield* MainDb.trash.listExpired({ before });
	yield* purge(expired.map((row) => row.id));
	return expired.length;
});

/** The daily job. */
export const purgeJob = Effect.gen(function* () {
	const count = yield* purgeExpired;
	if (count > 0) yield* Effect.log(`Purged ${count} item(s) from Trash`);
});

export const list = Effect.gen(function* () {
	const items = yield* MainDb.trash.list();
	const now = yield* Clock.currentTimeMillis;
	return {
		now,
		items: items.map((item) => ({ ...item, purgeAt: purgeAt(item.archived_at ?? now) })),
	};
});
