/**
 * Removing pages. Whatever the reader deletes (a page, a database, a row) goes
 * to Trash with everything inside it: hidden, restorable as one item, and
 * deleted for good after `ARCHIVE_DAYS`.
 */
import type { database } from "@modules/db";
import {
	archivePages,
	deletePages,
	detachHost,
	findDatabase,
	findPage,
	forgetPagesLinks,
	forgetPagesRelations,
	listArchivedWith,
	listExpiredArchive,
	listOwnedPages,
	restorePages,
} from "@space/db/main_db";

type Db = Awaited<ReturnType<typeof database>>;

export const ARCHIVE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/** When something archived at `archivedAt` is deleted for good. */
export const purgeAt = (archivedAt: number) => archivedAt + ARCHIVE_DAYS * DAY;

/** `id` and everything inside it that isn't archived yet: a database's rows, embedded databases, … */
async function treeOf(db: Db, id: string): Promise<string[]> {
	const ids = [id];
	let level = [id];
	while (level.length > 0 && ids.length < 20_000) {
		const owned = await listOwnedPages(db, { ids: JSON.stringify(level) });
		level = owned.map((row) => row.id).filter((child) => !ids.includes(child));
		ids.push(...level);
	}
	return ids;
}

/** Archives `id` with everything inside it, as one item to restore. */
export async function archiveTree(db: Db, id: string, now = Date.now()): Promise<void> {
	const ids = await treeOf(db, id);
	await archivePages(db, { ids: JSON.stringify(ids), root: id, now });
}

/** Deletes pages for good, with every link and relation to or from them. */
async function deleteForever(db: Db, ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	const json = JSON.stringify(ids);
	await forgetPagesLinks(db, { ids: json });
	await forgetPagesRelations(db, { ids: json });
	await deletePages(db, { ids: json });
}

/** Moves a page the reader deleted to Trash, with its rows and inline databases. */
export async function removePage(db: Db, id: string): Promise<void> {
	const page = await findPage(db, { id });
	if (!page || page.archived_at !== null) return;
	await archiveTree(db, id);
}

export type RestoreResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Brings back an archived item and what went with it. A row needs its database
 * back first. An inline database whose page is gone (or no longer embeds it)
 * comes back as a full-page database in the sidebar, unless `keepHost` (Undo).
 */
export async function restore(
	db: Db,
	id: string,
	{ keepHost = false }: { keepHost?: boolean } = {},
): Promise<RestoreResult> {
	const page = await findPage(db, { id });
	if (!page || page.archived_at === null || page.archived_with !== id) {
		return { ok: false, error: "not_archived" };
	}
	if (page.database_id && !(await findDatabase(db, { id: page.database_id }))) {
		return { ok: false, error: "database_archived" };
	}
	if (page.host_id) {
		const host = await findPage(db, { id: page.host_id });
		// Undo right after deleting an inline database puts its block back, so it
		// stays attached even if the page saved without it in between.
		const live = host && host.archived_at === null;
		const embedded = live && (keepHost || (host.content ?? "").includes(id));
		if (!embedded) await detachHost(db, { id });
	}
	await restorePages(db, { root: id });
	return { ok: true, id };
}

/** Deletes archived items (and what went with them) for good. */
export async function purge(db: Db, roots: string[]): Promise<void> {
	if (roots.length === 0) return;
	const ids = await listArchivedWith(db, { roots: JSON.stringify(roots) });
	await deleteForever(
		db,
		ids.map((row) => row.id),
	);
}

/** Deletes everything archived longer than `ARCHIVE_DAYS` ago. Returns how many items. */
export async function purgeExpired(db: Db, now = Date.now()): Promise<number> {
	const expired = await listExpiredArchive(db, { before: now - ARCHIVE_DAYS * DAY });
	await purge(
		db,
		expired.map((row) => row.id),
	);
	return expired.length;
}
