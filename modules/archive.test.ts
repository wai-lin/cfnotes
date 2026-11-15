import { createPage, findPage, listArchive, listPages, listRows } from "@space/db/main_db";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ARCHIVE_DAYS, purge, purgeExpired, removePage, restore } from "./archive";
import { newDatabase } from "./database/server";
import { database } from "./db";
import { testD1 } from "./test-d1";

type Db = Awaited<ReturnType<typeof database>>;
let db: Db;

beforeAll(async () => {
	db = await database(testD1());
});

const rowsOf = async (id: string) => (await listRows(db, { databaseId: id })).map((r) => r.id);

describe("archive", () => {
	it("archives a database with its rows and restores them together", async () => {
		const dbId = await newDatabase(db, { folderId: null, hostId: null, title: "Tasks" });
		const rows = await rowsOf(dbId);
		expect(rows).toHaveLength(3);

		// A row deleted on its own is a separate archive item.
		await removePage(db, rows[0]!);
		expect(await rowsOf(dbId)).toHaveLength(2);

		await removePage(db, dbId);
		expect((await listPages(db, {})).some((p) => p.id === dbId)).toBe(false);
		const items = await listArchive(db, {});
		const item = items.find((i) => i.id === dbId)!;
		expect(item.items).toBe(3); // the database and its two remaining rows

		// The lone row can't come back before its database.
		expect(await restore(db, rows[0]!)).toEqual({ ok: false, error: "database_archived" });
		expect(await restore(db, dbId)).toEqual({ ok: true, id: dbId });
		expect(await rowsOf(dbId)).toHaveLength(2);
		expect(await restore(db, rows[0]!)).toEqual({ ok: true, id: rows[0] });
		expect(await rowsOf(dbId)).toHaveLength(3);
	});

	it("moves a plain page to Trash with its inline databases, and restores them together", async () => {
		const host = crypto.randomUUID();
		await createPage(db, { id: host, folderId: null, title: "Host", now: Date.now() });
		const inline = await newDatabase(db, { folderId: null, hostId: host });
		const inlineRows = await rowsOf(inline);

		await removePage(db, host);
		expect((await findPage(db, { id: host }))?.archived_at).not.toBeNull();
		expect((await findPage(db, { id: inline }))?.archived_with).toBe(host);
		const item = (await listArchive(db, {})).find((i) => i.id === host)!;
		expect(item.items).toBe(2 + inlineRows.length); // one Trash item: page, database, rows
		expect((await listArchive(db, {})).some((i) => i.id === inline)).toBe(false);

		expect(await restore(db, host)).toEqual({ ok: true, id: host });
		expect((await listPages(db, {})).some((p) => p.id === host)).toBe(true);
		const back = await findPage(db, { id: inline });
		expect(back?.archived_at).toBeNull();
		expect(back?.host_id).toBe(host); // still on its page
		expect(await rowsOf(inline)).toHaveLength(inlineRows.length);
	});

	it("an inline database restored without its page becomes a full-page database", async () => {
		const host = crypto.randomUUID();
		await createPage(db, { id: host, folderId: null, title: "Host", now: Date.now() });
		const inline = await newDatabase(db, { folderId: null, hostId: host });
		await removePage(db, inline); // trashed on its own; the page never embeds it again
		await removePage(db, host);
		await purge(db, [host]);

		await restore(db, inline);
		const back = await findPage(db, { id: inline });
		expect(back?.archived_at).toBeNull();
		expect(back?.host_id).toBeNull(); // its page is gone, so it's in the sidebar now
		expect((await listPages(db, {})).some((p) => p.id === inline)).toBe(true);
	});

	it("Undo keeps an inline database on its page even after the page saved without it", async () => {
		const host = crypto.randomUUID();
		await createPage(db, { id: host, folderId: null, title: "Host", now: Date.now() });
		const inline = await newDatabase(db, { folderId: null, hostId: host });
		await removePage(db, inline); // the page's content never mentions it here

		expect(await restore(db, inline, { keepHost: true })).toEqual({ ok: true, id: inline });
		const back = await findPage(db, { id: inline });
		expect(back?.archived_at).toBeNull();
		expect(back?.host_id).toBe(host);
		expect((await listPages(db, {})).some((p) => p.id === inline)).toBe(false);
	});

	it("deletes for good on request and after the retention period", async () => {
		const a = await newDatabase(db, { folderId: null, hostId: null });
		const b = await newDatabase(db, { folderId: null, hostId: null });
		const aRows = await rowsOf(a);
		await removePage(db, a);
		await removePage(db, b);

		await purge(db, [a]);
		expect(await findPage(db, { id: a })).toBeUndefined();
		expect(await findPage(db, { id: aRows[0]! })).toBeUndefined();

		expect(await purgeExpired(db)).toBe(0); // b was archived just now
		const later = Date.now() + (ARCHIVE_DAYS + 1) * 24 * 60 * 60 * 1000;
		expect(await purgeExpired(db, later)).toBeGreaterThanOrEqual(1);
		expect(await findPage(db, { id: b })).toBeUndefined();
	});
});
