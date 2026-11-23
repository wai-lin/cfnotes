import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import type { DatabaseState } from "./columns.ts";

interface Reply {
	state: DatabaseState;
	columnId?: string;
}

async function setup() {
	const app = cfnotes();
	const { path } = await app.open();
	const op = async (body: object) => (await (await app.post(path, "dbOp", body)).json()) as Reply;
	const status = async (body: object) => (await app.post(path, "dbOp", body)).status;
	const create = async () => (await op({ op: "create" })).state;
	return { app, path, op, status, create };
}

describe("database", () => {
	it("stores cells and reads them back", async () => {
		const { app, op, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		const { columnId } = await op({ op: "addColumn", databaseId, type: "number", name: "Hours" });
		const rowId = db.rows[0]!.id;
		await op({ op: "setCell", databaseId, rowId, columnId, value: 7 });
		const { state } = await op({ op: "get", databaseId });
		expect(state.rows[0]!.cells[columnId!]).toBe(7);
	});

	it("shows a two-way relation from both sides", async () => {
		const { app, op, create } = await setup();
		await using _ = app;
		const tasks = await create();
		const projects = await create();
		const relation = { databaseId: projects.id, twoWay: true };
		const added = await op({ op: "addColumn", databaseId: tasks.id, type: "relation", relation });
		const task = tasks.rows[0]!.id;
		const project = projects.rows[1]!.id;
		await op({
			op: "setCell",
			databaseId: tasks.id,
			rowId: task,
			columnId: added.columnId,
			value: [project],
		});
		const other = (await op({ op: "get", databaseId: projects.id })).state;
		const back = other.columns.find((column) => column.type === "relation")!;
		expect(other.rows[1]!.cells[back.id]).toEqual([task]);
	});

	it("fills in who made and last edited a row, and when", async () => {
		const { app, op, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		const ids: Record<string, string> = {};
		for (const type of ["created_time", "created_by", "last_edited_time", "last_edited_by"]) {
			ids[type] = (await op({ op: "addColumn", databaseId, type })).columnId!;
		}
		const { columnId: notes } = await op({ op: "addColumn", databaseId, type: "text" });
		const rowId = db.rows[0]!.id;
		const before = (await op({ op: "get", databaseId })).state.rows[0]!.cells;
		expect(before[ids.created_by!]).toBe("owner@example.com");
		expect(before[ids.created_time!]).toBeTypeOf("number");

		await new Promise((resolve) => setTimeout(resolve, 5));
		const { state } = await op({ op: "setCell", databaseId, rowId, columnId: notes, value: "hi" });
		const after = state.rows[0]!.cells;
		expect(after[ids.last_edited_by!]).toBe("owner@example.com");
		expect(after[ids.last_edited_time!] as number).toBeGreaterThan(
			before[ids.last_edited_time!] as number,
		);
		expect(after[ids.created_time!]).toBe(before[ids.created_time!]);
	});

	it("doesn't store automatic values, and refuses to set them", async () => {
		const { app, op, status, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		const { columnId } = await op({ op: "addColumn", databaseId, type: "created_by" });
		const rowId = db.rows[0]!.id;
		expect(
			await status({ op: "setCell", databaseId, rowId, columnId, value: "someone@example.com" }),
		).toBe(400);
		// Turned into text, the column shows nothing: the email was never stored under it.
		const { state } = await op({ op: "setColumnType", databaseId, columnId, type: "text" });
		expect(state.rows[0]!.cells[columnId!]).toBeUndefined();
	});

	it("names only people who may sign in in a Person property", async () => {
		const { app, op, status, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		expect(db.people).toEqual(["owner@example.com"]);
		const { columnId } = await op({ op: "addColumn", databaseId, type: "person" });
		const rowId = db.rows[0]!.id;
		const value = ["Owner@Example.com"];
		const { state } = await op({ op: "setCell", databaseId, rowId, columnId, value });
		expect(state.rows[0]!.cells[columnId!]).toEqual(["owner@example.com"]);
		const stranger = ["stranger@example.com"];
		expect(await status({ op: "setCell", databaseId, rowId, columnId, value: stranger })).toBe(400);
	});

	it("starts a Status property with a group for each stage, and boards group by it", async () => {
		const { app, op, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		const { state, columnId } = await op({ op: "addColumn", databaseId, type: "status" });
		const column = state.columns.find((c) => c.id === columnId)!;
		expect(column.options!.map((o) => [o.name, o.group])).toEqual([
			["Not started", "todo"],
			["In progress", "in_progress"],
			["Done", "complete"],
		]);
		const done = column.options![2]!.id;
		const rowId = db.rows[0]!.id;
		const moved = await op({ op: "moveRow", databaseId, rowId, columnId, value: done });
		expect(moved.state.rows[0]!.cells[columnId!]).toBe(done);
		const named = await op({
			op: "setCell",
			databaseId,
			rowId,
			columnId,
			value: { name: "Review" },
		});
		const review = named.state.columns.find((c) => c.id === columnId)!.options!.at(-1)!;
		expect([review.name, review.group]).toEqual(["Review", "todo"]);
	});

	it("keeps only our own uploads in a Files & media property", async () => {
		const { app, op, status, create } = await setup();
		await using _ = app;
		const db = await create();
		const databaseId = db.id;
		const { columnId } = await op({ op: "addColumn", databaseId, type: "files" });
		const rowId = db.rows[0]!.id;
		const file = { key: `file/${crypto.randomUUID()}.pdf`, name: "Draft.pdf" };
		const { state } = await op({ op: "setCell", databaseId, rowId, columnId, value: [file] });
		expect(state.rows[0]!.cells[columnId!]).toEqual([file]);
		for (const key of [
			"https://evil.example/x.png",
			"../secret",
			`img/${crypto.randomUUID()}.exe`,
		]) {
			const value = [{ key, name: "x" }];
			expect(await status({ op: "setCell", databaseId, rowId, columnId, value })).toBe(400);
		}
	});

	it("refuses bad changes with a status the table understands", async () => {
		const { app, status, create } = await setup();
		await using _ = app;
		const databaseId = (await create()).id;
		expect(await status({ op: "addColumn", databaseId, type: "rollup" })).toBe(400);
		expect(await status({ op: "deleteRow", databaseId, rowId: "nope" })).toBe(400);
		expect(await status({ op: "get", databaseId: crypto.randomUUID() })).toBe(404);
		expect(await status({ op: "get", databaseId: "nope" })).toBe(404);
		expect(await status({ op: "nope", databaseId })).toBe(422);
	});
});
