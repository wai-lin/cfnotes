// Node's types for this test-only file; the app itself targets Workers.
// oxlint-disable-next-line triple-slash-reference
/// <reference types="node" />
/**
 * An in-memory stand-in for a D1 database, backed by Node's built-in SQLite.
 * Enough of the D1 API for spacefn's executor and migrations, for unit tests.
 */
import { DatabaseSync } from "node:sqlite";

type Param = string | number | null;

export function testD1(): D1Database {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec("PRAGMA foreign_keys = ON");

	const prepare = (sql: string) => {
		let params: Param[] = [];
		const statement = {
			bind(...values: unknown[]) {
				params = values.map((v) => (v === undefined ? null : (v as Param)));
				return statement;
			},
			async all() {
				return { results: sqlite.prepare(sql).all(...params), success: true, meta: {} };
			},
			async run() {
				sqlite.prepare(sql).run(...params);
				return { results: [], success: true, meta: {} };
			},
			async first() {
				return sqlite.prepare(sql).get(...params) ?? null;
			},
			runSync() {
				sqlite.prepare(sql).run(...params);
			},
		};
		return statement;
	};

	return {
		prepare,
		async batch(statements: { runSync(): void }[]) {
			sqlite.exec("BEGIN");
			try {
				for (const statement of statements) statement.runSync();
				sqlite.exec("COMMIT");
			} catch (error) {
				sqlite.exec("ROLLBACK");
				throw error;
			}
			return statements.map(() => ({ results: [], success: true, meta: {} }));
		},
		async exec(sql: string) {
			sqlite.exec(sql);
			return { count: 1, duration: 0 };
		},
	} as unknown as D1Database;
}
