import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { testDb } from "spacefn/testing";
import { describe, expect, it } from "vitest";

import { newDatabase } from "#modules/database/database.ts";
import MainDb from "#space/db/main.ts";

import * as Trash from "./trash.ts";

/** Runs on a fresh database and a clock the test moves. */
const run = <A, E>(test: Effect.Effect<A, E, MainDb>) =>
	Effect.runPromise(test.pipe(Effect.provide(Layer.mergeAll(testDb(MainDb), TestClock.layer()))));

const rowsOf = (databaseId: string) =>
	Effect.map(MainDb.listRows({ databaseId }), (rows) => rows.map((row) => row.id));
const find = (id: string) => Effect.map(MainDb.findPage({ id }), Option.getOrUndefined);
const inSidebar = (id: string) =>
	Effect.map(MainDb.listPages(), (pages) => pages.some((page) => page.id === id));

const hostWithDatabase = Effect.gen(function* () {
	const host = crypto.randomUUID();
	yield* MainDb.createPage({ id: host, folderId: null, title: "Host", now: 0 });
	return { host, inline: yield* newDatabase({ folderId: null, hostId: host }) };
});

describe("Trash", () => {
	it("trashes a database with its rows and restores them together", () =>
		run(
			Effect.gen(function* () {
				const db = yield* newDatabase({ folderId: null, hostId: null, title: "Tasks" });
				const rows = yield* rowsOf(db);
				expect(rows).toHaveLength(3);

				// A row deleted on its own is a separate item.
				yield* Trash.remove(rows[0]!);
				expect(yield* rowsOf(db)).toHaveLength(2);

				yield* Trash.remove(db);
				expect(yield* inSidebar(db)).toBe(false);
				const item = (yield* MainDb.listArchive()).find((i) => i.id === db)!;
				expect(item.items).toBe(3); // the database and its two remaining rows

				// The lone row can't come back before its database.
				expect(yield* Trash.restore(rows[0]!)).toEqual({ ok: false, error: "database_archived" });
				expect(yield* Trash.restore(db)).toEqual({ ok: true, id: db });
				expect(yield* rowsOf(db)).toHaveLength(2);
				expect(yield* Trash.restore(rows[0]!)).toEqual({ ok: true, id: rows[0] });
				expect(yield* rowsOf(db)).toHaveLength(3);
			}),
		));

	it("moves a page to Trash with its inline databases, and restores them together", () =>
		run(
			Effect.gen(function* () {
				const { host, inline } = yield* hostWithDatabase;
				const rows = yield* rowsOf(inline);

				yield* Trash.remove(host);
				expect((yield* find(host))?.archived_at).not.toBeNull();
				expect((yield* find(inline))?.archived_with).toBe(host);
				const items = yield* MainDb.listArchive();
				expect(items.find((i) => i.id === host)!.items).toBe(2 + rows.length);
				expect(items.some((i) => i.id === inline)).toBe(false);

				expect(yield* Trash.restore(host)).toEqual({ ok: true, id: host });
				expect(yield* inSidebar(host)).toBe(true);
				const back = yield* find(inline);
				expect(back?.archived_at).toBeNull();
				expect(back?.host_id).toBe(host); // still on its page
				expect(yield* rowsOf(inline)).toHaveLength(rows.length);
			}),
		));

	it("restores an inline database without its page as a full-page database", () =>
		run(
			Effect.gen(function* () {
				const { host, inline } = yield* hostWithDatabase;
				yield* Trash.remove(inline);
				yield* Trash.remove(host);
				yield* Trash.purge([host]);

				yield* Trash.restore(inline);
				const back = yield* find(inline);
				expect(back?.archived_at).toBeNull();
				expect(back?.host_id).toBeNull();
				expect(yield* inSidebar(inline)).toBe(true);
			}),
		));

	it("keeps an inline database on its page when Undo restores it", () =>
		run(
			Effect.gen(function* () {
				const { host, inline } = yield* hostWithDatabase;
				yield* Trash.remove(inline); // the page's content never mentions it here

				expect(yield* Trash.restore(inline, { keepHost: true })).toEqual({ ok: true, id: inline });
				const back = yield* find(inline);
				expect(back?.archived_at).toBeNull();
				expect(back?.host_id).toBe(host);
				expect(yield* inSidebar(inline)).toBe(false);
			}),
		));

	it("deletes for good on request, and after the retention period", () =>
		run(
			Effect.gen(function* () {
				const a = yield* newDatabase({ folderId: null, hostId: null });
				const b = yield* newDatabase({ folderId: null, hostId: null });
				const aRows = yield* rowsOf(a);
				yield* Trash.remove(a);
				yield* Trash.remove(b);

				yield* Trash.purge([a]);
				expect(yield* find(a)).toBeUndefined();
				expect(yield* find(aRows[0]!)).toBeUndefined();

				expect(yield* Trash.purgeExpired).toBe(0);
				yield* TestClock.adjust(`${Trash.TRASH_DAYS - 1} days`);
				expect(yield* Trash.purgeExpired).toBe(0);
				yield* TestClock.adjust("2 days");
				expect(yield* Trash.purgeExpired).toBe(1);
				expect(yield* find(b)).toBeUndefined();
			}),
		));
});
