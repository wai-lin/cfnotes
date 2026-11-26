import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { mcp, type App, type Json } from "./testing.ts";

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

describe("querying a database over MCP", () => {
	/** A database of posts: Status, Views, Date, Tags, Featured. */
	async function posts(app: App) {
		const call = await mcp(app);
		const { data: db } = await call("create_database", {
			title: "Posts",
			properties: [
				{ name: "Status", type: "select", options: ["Draft", "Published"] },
				{ name: "Views", type: "number" },
				{ name: "Date", type: "date" },
				{ name: "Featured", type: "checkbox" },
			],
		});
		const add = (title: string, properties: object) =>
			call("create_page", { title, database_id: db.id, properties });
		await add("Hello", {
			Status: "Published",
			Views: 120,
			Date: "2026-10-02",
			Tags: ["news"],
			Featured: true,
		});
		await add("Draft idea", { Status: "Draft", Views: 0 });
		await add("November notes", {
			Status: "Published",
			Views: 40,
			Date: "2026-11-05",
			Tags: ["notes"],
		});
		await add("Big launch", {
			Status: "Published",
			Views: 900,
			Date: "2026-11-20",
			Tags: ["news", "launch"],
		});
		const query = async (args: object) => {
			const res = await call("query_database", { database_id: db.id, sort: ["Name"], ...args });
			return res.error ? res.text : (res.data.rows as Json[]).map((r) => r.title);
		};
		return { db, query, token: await app.token("read") };
	}

	it("filters with the table's operators", async () => {
		await using app = cfnotes();
		const { query } = await posts(app);
		expect(await query({ where: { Date: { on_or_after: "2026-11-01" } } })).toEqual([
			"Big launch",
			"November notes",
		]);
		expect(await query({ where: { Date: { after: "2026-11-01", before: "2026-11-10" } } })).toEqual(
			["November notes"],
		);
		expect(await query({ where: { Views: { gt: 100 } } })).toEqual(["Big launch", "Hello"]);
		expect(await query({ where: { Views: { lte: 40 } } })).toEqual([
			"Draft idea",
			"November notes",
		]);
		expect(await query({ where: { Date: { empty: true } } })).toEqual(["Draft idea"]);
		expect(await query({ where: { Tags: { not_empty: true }, Featured: false } })).toEqual([
			"Big launch",
			"November notes",
		]);
		expect(await query({ where: { Status: { is_not: "Draft" }, Tags: "news" } })).toEqual([
			"Big launch",
			"Hello",
		]);
		expect(await query({ where: { Name: { starts_with: "b" } } })).toEqual(["Big launch"]);
		// Plain values still mean equality.
		expect(await query({ where: { Status: "draft", Views: 0 } })).toEqual(["Draft idea"]);
	});

	it("keeps rows matching any of where_any's groups", async () => {
		await using app = cfnotes();
		const { query } = await posts(app);
		expect(await query({ where_any: [{ Status: "Draft" }, { Views: { gte: 500 } }] })).toEqual([
			"Big launch",
			"Draft idea",
		]);
		expect(
			await query({
				where: { Status: "Published" },
				where_any: [{ Featured: true }, { Tags: "launch" }],
			}),
		).toEqual(["Big launch", "Hello"]);
	});

	it("says what's wrong with a filter", async () => {
		await using app = cfnotes();
		const { query } = await posts(app);
		expect(await query({ where: { Views: { starts_with: "1" } } })).toBe(
			'BadRequest: "Views" (number) has no "starts_with"; it takes eq, neq, gt, lt, gte, lte, empty, not_empty',
		);
		expect(await query({ where: { Views: { gt: "lots" } } })).toBe(
			'BadRequest: "Views" is a number, not "lots"',
		);
		expect(await query({ where: { Date: { after: "November" } } })).toContain("YYYY-MM-DD");
		expect(await query({ where: { Status: "Gone" } })).toBe(
			'BadRequest: No option "Gone" in "Status"; there are "Draft", "Published"',
		);
	});

	it("takes the same operators over REST", async () => {
		await using app = cfnotes();
		const { db, token } = await posts(app);
		const rows = async (search: string) =>
			(
				(
					(await (
						await app.api(token, `/api/v1/databases/${db.id}/rows?sort=Name&${search}`)
					).json()) as Json
				).rows as Json[]
			).map((r) => r.title);
		expect(await rows("where.Date:on_or_after=2026-11-01")).toEqual([
			"Big launch",
			"November notes",
		]);
		expect(await rows("where.Date:empty")).toEqual(["Draft idea"]);
		expect(await rows("any.0.Status=Draft&any.1.Views:gte=500")).toEqual([
			"Big launch",
			"Draft idea",
		]);
	});
});

describe("a database's views over MCP", () => {
	it("adds, changes and deletes views with filters, sorts and grouping", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", {
			title: "Tasks",
			properties: [
				{ name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
				{ name: "Due", type: "date" },
				{ name: "Ends", type: "date" },
			],
		});
		const board = await call("create_view", {
			database_id: db.id,
			name: "Open work",
			layout: "board",
			where: { Status: { is_not: "Done" }, Due: { not_empty: true } },
			sort: ["-Due"],
		});
		expect(board.error).toBe(false);
		expect(board.data).toMatchObject({
			name: "Open work",
			layout: "board",
			groupBy: "Status",
			filters: [
				{ property: "Status", operator: "is_not", value: "Done" },
				{ property: "Due", operator: "not_empty" },
			],
			sort: ["-Due"],
		});

		await call("create_page", {
			title: "Write",
			database_id: db.id,
			properties: { Status: "Doing", Due: "2026-11-30" },
		});
		await call("create_page", {
			title: "Ship",
			database_id: db.id,
			properties: { Status: "Done", Due: "2026-11-02" },
		});
		const rows = await call("query_database", { database_id: db.id, view: "open work" });
		expect((rows.data.rows as Json[]).map((r) => r.title)).toEqual(["Write"]);

		// A timeline picks its dates from the database; a new layout drops the board's lanes.
		const timeline = await call("update_view", {
			database_id: db.id,
			view: "Open work",
			layout: "timeline",
			end_by: "Ends",
		});
		expect(timeline.data).toMatchObject({ layout: "timeline", dateBy: "Due", endBy: "Ends" });
		expect(timeline.data.groupBy).toBeUndefined();

		const described = await call("get_database", { database_id: db.id });
		expect((described.data.views as Json[]).map((v) => v.name)).toEqual(["Table", "Open work"]);

		expect((await call("delete_view", { database_id: db.id, view: "Open work" })).text).toBe(
			"Deleted the view.",
		);
		expect((await call("delete_view", { database_id: db.id, view: "Table" })).text).toBe(
			"BadRequest: A database keeps at least one view",
		);
	});

	it("refuses settings the view couldn't keep, and makes nothing", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", {
			title: "Notes",
			properties: [{ name: "Due", type: "date" }],
		});
		const tries = [
			[{ layout: "board", group_by: "Due" }, 'A board groups by a select; "Due" isn\'t one'],
			[{ layout: "calendar", date_by: "Name" }, "\"Name\" isn't a date, so it can't place rows"],
			[{ layout: "gallery", row_numbers: true }, "Only a table shows row numbers"],
			[{ layout: "table", sort: ["Nope"] }, 'No property "Nope"'],
		] as const;
		for (const [settings, message] of tries) {
			const res = await call("create_view", { database_id: db.id, ...settings });
			expect(res.text, JSON.stringify(settings)).toContain(message);
		}
		const after = await call("get_database", { database_id: db.id });
		expect(after.data.views).toHaveLength(1);
		expect((await call("update_view", { database_id: db.id, view: "Gone" })).text).toBe(
			'BadRequest: No view "Gone": there are "Table"',
		);
	});
});
