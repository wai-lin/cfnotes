import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

type Json = Record<string, any>;
type App = ReturnType<typeof cfnotes>;

/** Calls an MCP tool with a write token: its text, parsed when it's JSON, and whether it failed. */
async function mcp(app: App) {
	const token = await app.token("write");
	return async (name: string, args: object) => {
		const res = await app.api(token, "/api/mcp", {
			method: "POST",
			json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
		});
		const { result } = (await res.json()) as {
			result: { content: { text: string }[]; isError?: boolean };
		};
		const text = result.content[0]!.text;
		let data: Json = {};
		try {
			data = JSON.parse(text) as Json;
		} catch {}
		return { text, data, error: result.isError === true };
	};
}

describe("making databases over MCP", () => {
	it("makes one with its properties and no rows", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const made = await call("create_database", {
			title: "Reading list",
			icon: "📚",
			properties: [
				{ name: "Status", type: "select", options: ["To read", { name: "Done", color: "green" }] },
				{ name: "Pages", type: "number" },
				{ name: "Score", type: "script", script: 'return row["Pages"] * 2;' },
			],
		});
		expect(made.error).toBe(false);
		expect(made.data).toMatchObject({ title: "Reading list", rows: 0, hostId: null });
		const props = made.data.properties as Json[];
		expect(props.map((p) => p.name)).toEqual(["Name", "Tags", "Status", "Pages", "Score"]);
		expect(props[2]!.options).toEqual([
			{ name: "To read", color: expect.any(String) },
			{ name: "Done", color: "green" },
		]);
		expect(props[4]).toMatchObject({ type: "script", script: 'return row["Pages"] * 2;' });

		// (Scripts run in QuickJS, which doesn't load under the tests, so its value isn't checked.)
		const row = await call("create_page", {
			title: "Dune",
			database_id: made.data.id,
			properties: { Status: "Done", Pages: 412 },
		});
		expect(row.text).toContain('"Status": "Done"');
	});

	it("puts an inline one at the end of a page", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const page = await call("create_page", { title: "Trip", markdown: "Plans." });
		const pageId = /"id": "([0-9a-f-]{36})"/.exec(page.text)![1]!;
		const made = await call("create_database", { title: "Packing", page_id: pageId });
		expect(made.data.hostId).toBe(pageId);
		const read = await call("read_page", { page_id: pageId });
		expect(read.text).toContain(`Plans.\n\n[Packing](/p/${made.data.id})`);
		// Not in a row, and not in a folder that isn't there.
		expect(
			(await call("create_database", { title: "x", folder_id: crypto.randomUUID() })).text,
		).toBe("NotFound: No such folder");
	});
});

describe("changing a database over MCP", () => {
	it("adds, renames, converts, moves and deletes properties and options", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", {
			title: "Posts",
			properties: [{ name: "Stage", type: "select", options: ["Draft", "Live"] }],
		});
		const changed = await call("update_database", {
			database_id: db.id,
			title: "Blog posts",
			changes: [
				{ action: "add_property", name: "Words", type: "text", before: "Tags" },
				{ action: "change_type", property: "Words", type: "number" },
				{ action: "rename_property", property: "stage", name: "Status" },
				{ action: "add_option", property: "Status", option: "Archived", color: "gray" },
				{
					action: "update_option",
					property: "Status",
					option: "Live",
					name: "Published",
					color: "green",
				},
				{ action: "delete_option", property: "Status", option: "Draft" },
				{ action: "move_property", property: "Status", before: "Words" },
				{ action: "delete_property", property: "Tags" },
			],
		});
		expect(changed.error).toBe(false);
		expect(changed.data.title).toBe("Blog posts");
		expect(changed.data.properties).toEqual([
			{ name: "Name", type: "title" },
			{
				name: "Status",
				type: "select",
				options: [
					{ name: "Published", color: "green" },
					{ name: "Archived", color: "gray" },
				],
			},
			{ name: "Words", type: "number" },
		]);
	});

	it("says which change failed and why", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", { title: "Tasks" });
		const failed = await call("update_database", {
			database_id: db.id,
			changes: [
				{ action: "add_property", name: "Done", type: "checkbox" },
				{ action: "update_option", property: "Tags", option: "Nope", name: "x" },
			],
		});
		expect(failed.error).toBe(true);
		expect(failed.text).toBe(
			'BadRequest: Change 2 of 2: update_option "Tags": no option "Nope"; there are none (changes before it were made)',
		);
		const missing = await call("update_database", {
			database_id: db.id,
			changes: [{ action: "delete_property", property: "Nope" }],
		});
		expect(missing.text).toContain('No property "Nope": there are "Name", "Tags", "Done"');
		const broken = await call("update_database", {
			database_id: db.id,
			changes: [{ action: "add_property", name: "Bad", type: "script", script: "return (" }],
		});
		expect(broken.text).toContain("The script doesn't compile");
	});

	it("links databases with relations and rolls them up", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: authors } = await call("create_database", {
			title: "Authors",
			properties: [{ name: "Born", type: "number" }],
		});
		const books = await call("create_database", {
			title: "Books",
			properties: [
				{ name: "Author", type: "relation", relation: { database_id: authors.id, two_way: true } },
				{
					name: "Born",
					type: "rollup",
					rollup: { relation: "Author", property: "Born", function: "earliest" },
				},
			],
		});
		expect(books.error).toBe(true);
		expect(books.text).toContain('Function "earliest" doesn\'t work on number');

		const { data: shelf } = await call("create_database", {
			title: "Shelf",
			properties: [
				{ name: "Author", type: "relation", relation: { database_id: authors.id, two_way: true } },
				{
					name: "Born",
					type: "rollup",
					rollup: { relation: "Author", property: "Born", function: "min" },
				},
			],
		});
		const props = shelf.properties as Json[];
		expect(props.find((p) => p.name === "Author")).toMatchObject({
			type: "relation",
			relation: { databaseId: authors.id, twoWay: true },
		});
		expect(props.find((p) => p.name === "Born")).toMatchObject({
			rollup: { relation: "Author", property: "Born", function: "min" },
		});
		const back = await call("get_database", { database_id: authors.id });
		expect((back.data.properties as Json[]).map((p) => p.name)).toContain("Shelf");

		const author = await call("create_page", {
			title: "Le Guin",
			database_id: authors.id,
			properties: { Born: 1929 },
		});
		const authorId = /"id": "([0-9a-f-]{36})"/.exec(author.text)![1]!;
		const book = await call("create_page", {
			title: "The Dispossessed",
			database_id: shelf.id,
			properties: { Author: [authorId] },
		});
		expect(book.text).toContain('"Born": 1929');

		const changed = await call("update_database", {
			database_id: shelf.id,
			changes: [
				{ action: "set_rollup", property: "Born", relation: "Author", function: "count_all" },
			],
		});
		expect((changed.data.properties as Json[]).find((p) => p.name === "Born")).toMatchObject({
			rollup: { property: "Name", function: "count_all" },
		});
	});

	it("keeps read-only tokens from changing databases", async () => {
		await using app = cfnotes();
		const token = await app.token("read");
		const res = await app.api(token, "/api/mcp", {
			method: "POST",
			json: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "create_database", arguments: { title: "x" } },
			},
		});
		expect(((await res.json()) as Json).result.isError).toBe(true);
	});
});
