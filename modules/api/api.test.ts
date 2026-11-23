import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

type Json = Record<string, any>;

/** A database with Status, Tags, Date and Published properties, and its id. */
async function blog(app: ReturnType<typeof cfnotes>) {
	const { path } = await app.open();
	const op = async (body: object) =>
		(await (await app.post(path, "dbOp", body)).json()) as { state: Json; rowId?: string };
	const { state } = await op({ op: "create" });
	const databaseId = state.id as string;
	// The starter rows aren't posts.
	for (const row of state.rows as Json[]) await op({ op: "deleteRow", databaseId, rowId: row.id });
	for (const [type, name] of [
		["status", "Status"],
		["date", "Date"],
		["checkbox", "Featured"],
	])
		await op({ op: "addColumn", databaseId, type, name });
	return databaseId;
}

describe("the API", () => {
	it("needs a token, and a cookie counts for nothing", async () => {
		await using app = cfnotes();
		expect((await app.anonymous("/api/v1/pages")).status).toBe(401);
		// Signed in with a session cookie, still no.
		expect((await app.fetch("/api/v1/pages")).status).toBe(401);
		expect((await app.api("cfn_nope", "/api/v1/pages")).status).toBe(401);
		const token = await app.token("read");
		const me = await app.api(token, "/api/v1/me");
		expect(await me.json()).toEqual({ email: "owner@example.com", scope: "read" });
		expect(me.headers.get("cache-control")).toBe("no-store");
		// And a token opens nothing outside the API.
		const page = await app.anonymous("/", { headers: { authorization: `Bearer ${token}` } });
		expect(page.status).not.toBe(200);
	});

	it("stops a token when its owner can no longer sign in", async () => {
		await using app = cfnotes({ ALLOWED_EMAILS: "owner@example.com, gone@example.com" });
		const token = await app.token("read", "removed@example.com");
		expect((await app.api(token, "/api/v1/me")).status).toBe(401);
	});

	it("writes pages from Markdown and reads them back in each format", async () => {
		await using app = cfnotes();
		const token = await app.token("write");
		const res = await app.api(token, "/api/v1/pages", {
			method: "POST",
			json: { title: "Hello", markdown: "# Hi\n\nSome **bold** text.", icon: "👋" },
		});
		expect(res.status).toBe(201);
		const made = (await res.json()) as Json;
		expect(made).toMatchObject({ title: "Hello", icon: "👋", kind: "page", format: "markdown" });
		expect(made.content).toBe("# Hi\n\nSome **bold** text.");

		const html = (await (await app.api(token, `/api/v1/pages/${made.id}`)).json()) as Json;
		expect(html.content).toBe('<h1 id="hi">Hi</h1>\n<p>Some <strong>bold</strong> text.</p>');
		const doc = (await (
			await app.api(token, `/api/v1/pages/${made.id}?format=json`)
		).json()) as Json;
		expect(doc.content.root.children).toHaveLength(2);

		await app.api(token, `/api/v1/pages/${made.id}`, {
			method: "PATCH",
			json: { title: "Hello again", append: "More." },
		});
		const after = (await (
			await app.api(token, `/api/v1/pages/${made.id}?format=markdown`)
		).json()) as Json;
		expect(after).toMatchObject({
			title: "Hello again",
			content: "# Hi\n\nSome **bold** text.\n\nMore.",
		});
		// The app's search sees what the API wrote.
		const found = (await (await app.api(token, "/api/v1/search?q=bold")).json()) as Json;
		expect(found.results.map((r: Json) => r.id)).toContain(made.id);

		expect((await app.api(token, `/api/v1/pages/${made.id}`, { method: "DELETE" })).status).toBe(
			204,
		);
		expect((await app.api(token, `/api/v1/pages/${made.id}`)).status).toBe(404);
	});

	it("keeps read-only tokens to reading", async () => {
		await using app = cfnotes();
		const token = await app.token("read");
		const post = await app.api(token, "/api/v1/pages", { method: "POST", json: { title: "x" } });
		expect(post.status).toBe(403);
	});

	it("queries a database's rows by property, and sets properties by name", async () => {
		await using app = cfnotes();
		const databaseId = await blog(app);
		const token = await app.token("write");
		const add = async (title: string, properties: Json) => {
			const res = await app.api(token, "/api/v1/pages", {
				method: "POST",
				json: { title, database: databaseId, markdown: `About ${title}.`, properties },
			});
			expect(res.status).toBe(201);
			return (await res.json()) as Json;
		};
		const one = await add("One", { Status: "Done", Date: "2026-01-02", Tags: ["news"] });
		await add("Two", { Status: "Done", Date: "2026-03-04", Featured: true });
		await add("Draft", { Status: "In progress" });
		expect(one.properties).toMatchObject({ Status: "Done", Date: "2026-01-02", Tags: ["news"] });

		const db = (await (await app.api(token, `/api/v1/databases/${databaseId}`)).json()) as Json;
		expect(db.properties.map((p: Json) => p.name)).toEqual([
			"Name",
			"Tags",
			"Status",
			"Date",
			"Featured",
		]);

		const rows = async (query: string) =>
			(await (
				await app.api(token, `/api/v1/databases/${databaseId}/rows?${query}`)
			).json()) as Json;
		const done = await rows("where.Status=done&sort=-Date&content=html");
		expect(done.rows.map((r: Json) => r.title)).toEqual(["Two", "One"]);
		expect(done.rows[0].content).toBe("<p>About Two.</p>");
		expect((await rows("where.Featured=true")).rows.map((r: Json) => r.title)).toEqual(["Two"]);
		expect((await rows("where.Tags=news")).rows.map((r: Json) => r.title)).toEqual(["One"]);
		const paged = await rows("limit=2&sort=Name");
		expect(paged).toMatchObject({ total: 3, nextOffset: 2 });
		expect((await app.api(token, `/api/v1/databases/${databaseId}/rows?where.Nope=1`)).status).toBe(
			400,
		);

		// A new option name adds the option; a bad date says which property.
		await app.api(token, `/api/v1/pages/${one.id}`, {
			method: "PATCH",
			json: { properties: { Tags: ["news", "launch"] } },
		});
		expect((await rows("where.Tags=launch")).rows.map((r: Json) => r.title)).toEqual(["One"]);
		const bad = await app.api(token, `/api/v1/pages/${one.id}`, {
			method: "PATCH",
			json: { properties: { Date: "tomorrow" } },
		});
		expect(bad.status).toBe(400);
		expect(((await bad.json()) as Json).message).toContain('"Date"');
	});

	it("serves files and links them through the API, or where the caller says", async () => {
		await using app = cfnotes();
		const token = await app.token("write");
		const src = "/files/img/1b8a9a3e-8d5e-4f7e-9c51-2a4c8f1d3e70.png";
		const made = (await (
			await app.api(token, "/api/v1/pages", {
				method: "POST",
				json: { title: "Pic", markdown: `![A cat](http://localhost:1337/api/v1${src})` },
			})
		).json()) as Json;
		// Stored as the app's own path.
		const doc = (await (
			await app.api(token, `/api/v1/pages/${made.id}?format=json`)
		).json()) as Json;
		expect(doc.content.root.children[0].src).toBe(src);
		const html = (await (
			await app.api(token, `/api/v1/pages/${made.id}?fileUrl=/media/{key}`)
		).json()) as Json;
		expect(html.content).toContain(`src="/media/img/1b8a9a3e-8d5e-4f7e-9c51-2a4c8f1d3e70.png"`);
		expect((await app.api(token, `/api/v1/files${src.slice(6)}`)).status).toBe(404);
	});

	it("comments as the token's owner", async () => {
		await using app = cfnotes();
		const { id } = await app.open();
		const token = await app.token("write");
		const res = await app.api(token, `/api/v1/pages/${id}/comments`, {
			method: "POST",
			json: { body: "From the API" },
		});
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({
			quote: null,
			comments: [{ author: "owner@example.com", body: "From the API" }],
		});
	});
});

describe("the MCP server", () => {
	const rpc = (app: ReturnType<typeof cfnotes>, token: string, method: string, params?: object) =>
		app.api(token, "/api/mcp", {
			method: "POST",
			headers: { accept: "application/json, text/event-stream" },
			json: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
		});
	const call = async (app: ReturnType<typeof cfnotes>, token: string, name: string, args: object) =>
		((await (await rpc(app, token, "tools/call", { name, arguments: args })).json()) as Json)
			.result as { content: { text: string }[]; isError?: boolean };

	it("introduces itself and lists the tools a token may use", async () => {
		await using app = cfnotes();
		const read = await app.token("read");
		const init = (await (
			await rpc(app, read, "initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			})
		).json()) as Json;
		expect(init.result).toMatchObject({
			protocolVersion: "2025-06-18",
			serverInfo: { name: "cfnotes" },
		});
		const notified = await app.api(read, "/api/mcp", {
			method: "POST",
			json: { jsonrpc: "2.0", method: "notifications/initialized" },
		});
		expect(notified.status).toBe(202);

		const names = async (token: string) =>
			(((await (await rpc(app, token, "tools/list")).json()) as Json).result.tools as Json[]).map(
				(t) => t.name,
			);
		expect(await names(read)).not.toContain("create_page");
		expect(await names(await app.token("write"))).toContain("create_page");
		expect((await call(app, read, "create_page", { title: "x" })).isError).toBe(true);
		expect(((await (await rpc(app, read, "nope")).json()) as Json).error.code).toBe(-32601);
	});

	it("refuses other sites' pages and requests without a token", async () => {
		await using app = cfnotes();
		const token = await app.token("read");
		const res = await app.api(token, "/api/mcp", {
			method: "POST",
			headers: { origin: "https://evil.test" },
			json: { jsonrpc: "2.0", id: 1, method: "ping" },
		});
		expect(res.status).toBe(403);
		expect((await app.anonymous("/api/mcp", { method: "POST", body: "{}" })).status).toBe(401);
	});

	it("creates, reads, appends to and comments on pages", async () => {
		await using app = cfnotes();
		const token = await app.token("write");
		const made = await call(app, token, "create_page", { title: "Plan", markdown: "- one\n- two" });
		expect(made.isError).toBeUndefined();
		const id = /"id": "([0-9a-f-]{36})"/.exec(made.content[0]!.text)![1]!;

		await call(app, token, "update_page", { page_id: id, append_markdown: "Done." });
		await call(app, token, "add_comment", { page_id: id, body: "Looks good" });
		const read = (await call(app, token, "read_page", { page_id: id })).content[0]!.text;
		expect(read).toContain("# Plan");
		expect(read).toContain("- one\n- two\n\nDone.");
		expect(read).toContain("Looks good");

		const missing = await call(app, token, "read_page", { page_id: crypto.randomUUID() });
		expect(missing).toMatchObject({ isError: true, content: [{ text: "NotFound: No such page" }] });
	});

	it("answers changes made through the app's own session too", async () => {
		await using app = cfnotes();
		const token = await app.token("read");
		const { path, id } = await app.open();
		await app.post(path, "save", {
			doc: JSON.stringify({
				root: {
					type: "root",
					children: [
						{
							type: "paragraph",
							children: [{ type: "text", text: "Typed in the app", format: 0 }],
						},
					],
				},
			}),
		});
		const text = (await call(app, token, "read_page", { page_id: id })).content[0]!.text;
		expect(text).toContain("Typed in the app");
	});
});
