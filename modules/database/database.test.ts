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
