import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { idIn, mcp, type App, type Json } from "./testing.ts";

const FRIEND = "friend@example.com";

/**
 * The owner's workspace: a folder "Trip" shared with FRIEND as `role` (with a
 * page in it), a folder of the owner's own, and a page outside both.
 */
async function setUp(app: App, role = "edit") {
	const owner = await mcp(app);
	const trip = (await owner("create_folder", { name: "Trip" })).data;
	const mine = (await owner("create_folder", { name: "Mine" })).data;
	const plan = idIn((await owner("create_page", { title: "Plan", folder_id: trip.id })).text);
	const secret = idIn(
		(await owner("create_page", { title: "Secret", markdown: "Hidden words" })).text,
	);
	const { path } = await app.open();
	await app.post(path, "share", { op: "invite", kind: "folder", id: trip.id, email: FRIEND, role });
	return { owner, friend: await mcp(app, FRIEND), trip, mine, plan, secret };
}

describe("a friend's token", () => {
	it("works once something is shared with them, and stops when it isn't", async () => {
		await using app = cfnotes();
		const token = await app.token("write", FRIEND);
		const me = () => app.api(token, "/api/v1/me");
		expect((await me()).status).toBe(401);
		const { path, id } = await app.open();
		await app.post(path, "share", { op: "invite", kind: "page", id, email: FRIEND });
		expect(await (await me()).json()).toEqual({ email: FRIEND, scope: "write" });
		await app.post(path, "share", { op: "remove", kind: "page", id, email: FRIEND });
		expect((await me()).status).toBe(401);
	});

	it("lists, finds and reads only what's shared", async () => {
		await using app = cfnotes();
		const { friend, trip, plan, secret } = await setUp(app, "view");

		const pages = (await friend("list_pages", {})).data.pages as Json[];
		expect(pages.map((p) => p.title)).toEqual(["Plan"]);
		expect((await friend("list_folders", {})).data.folders).toEqual([
			{ id: trip.id, name: "Trip", parentId: null, path: "Trip", locked: false, access: "view" },
		]);
		expect((await friend("search", { query: "Hidden" })).data.results).toEqual([]);
		expect((await friend("read_page", { page_id: plan })).error).toBe(false);
		expect((await friend("read_page", { page_id: secret })).text).toBe("NotFound: No such page");

		// A viewer can't change it.
		const edited = await friend("update_page", { page_id: plan, title: "Mine" });
		expect(edited.text).toMatch(/^Forbidden/);
	});

	it("reads what they may do on a page, and who can be named there", async () => {
		await using app = cfnotes();
		const { owner, friend, plan } = await setUp(app);
		const read = async (call: typeof owner) =>
			(await call("read_page", { page_id: plan })).structured!;
		expect(await read(friend)).toMatchObject({ access: "edit" });
		expect((await read(friend)).people).toEqual([expect.any(String), FRIEND]);
		expect(await read(owner)).toMatchObject({ access: "owner" });
		// A lock leaves them commenting.
		await owner("update_page", { page_id: plan, locked: true });
		expect(await read(friend)).toMatchObject({ access: "comment" });
	});

	it("lists the comment threads they can see, and those that mention them", async () => {
		await using app = cfnotes();
		const { owner, friend, plan, secret } = await setUp(app);
		await owner("add_comment", { page_id: secret, body: "Not for friends" });
		await owner("add_comment", { page_id: plan, body: "Any thoughts?" });
		const asked = (
			await owner("add_comment", {
				page_id: plan,
				body: `[@Friend](mailto:${FRIEND}) can you book it?`,
			})
		).data;
		const listed = (await friend("list_comments", {})).data;
		expect(listed).toMatchObject({ total: 2, nextOffset: null });
		expect(listed.threads[0]).toMatchObject({ id: asked.id, page: { id: plan, title: "Plan" } });
		const mine = (await friend("list_comments", { mentions_me: true })).data;
		expect(mine.threads.map((t: Json) => t.id)).toEqual([asked.id]);
		// The owner sees theirs too; resolved ones only when asked for.
		expect((await owner("list_comments", { limit: 1 })).data).toMatchObject({
			total: 3,
			nextOffset: 1,
		});
		await friend("resolve_thread", { page_id: plan, thread_id: asked.id });
		expect((await friend("list_comments", {})).data.total).toBe(1);
		const resolved = (await friend("list_comments", { status: "resolved" })).data;
		expect(resolved.threads.map((t: Json) => t.id)).toEqual([asked.id]);
		// Over REST too.
		const token = await app.token("read", FRIEND);
		const rest = (await (
			await app.api(token, "/api/v1/comments?status=all&mentions=me")
		).json()) as Json;
		expect(rest.threads.map((t: Json) => t.id)).toEqual([asked.id]);
	});

	it("makes and changes things only in folders shared with them to edit", async () => {
		await using app = cfnotes();
		const { owner, friend, trip, mine, plan, secret } = await setUp(app);

		const made = await friend("create_page", { title: "Day 1", folder_id: trip.id });
		expect(made.error).toBe(false);
		const sub = (await friend("create_folder", { name: "Days", parent_id: trip.id })).data;
		expect(sub.path).toBe("Trip/Days");
		expect((await friend("move_page", { page_id: idIn(made.text), folder_id: sub.id })).error).toBe(
			false,
		);
		const db = await friend("create_database", { title: "Costs", folder_id: trip.id });
		expect(db.error).toBe(false);
		expect((await friend("update_page", { page_id: plan, append_markdown: "More" })).error).toBe(
			false,
		);

		// Not at the top level, nor in the owner's folder, nor on the owner's page.
		expect((await friend("create_page", { title: "Top" })).text).toMatch(/^Forbidden/);
		expect((await friend("create_folder", { name: "Top" })).text).toMatch(/^Forbidden/);
		expect((await friend("create_database", { title: "Top" })).text).toMatch(/^Forbidden/);
		expect((await friend("create_page", { title: "X", folder_id: mine.id })).text).toMatch(
			/^NotFound/,
		);
		expect((await friend("move_page", { page_id: plan, folder_id: null })).text).toMatch(
			/^Forbidden/,
		);
		expect((await friend("trash_page", { page_id: secret })).text).toBe("NotFound: No such page");
		expect((await friend("delete_folder", { folder_id: trip.id })).text).toMatch(/^Forbidden/);

		// Trash: what they put there, and nothing of the owner's.
		await owner("trash_page", { page_id: secret });
		expect((await friend("trash_page", { page_id: plan })).error).toBe(false);
		const trash = (await friend("list_trash", {})).data.items as Json[];
		expect(trash.map((item) => item.title)).toEqual(["Plan"]);
		expect((await friend("restore_page", { page_id: secret })).text).toBe("NotFound: No such page");
		expect((await friend("restore_page", { page_id: plan })).error).toBe(false);
	});

	it("is told what it reaches when it connects", async () => {
		await using app = cfnotes();
		await setUp(app);
		const token = await app.token("read", FRIEND);
		const res = await app.api(token, "/api/mcp", {
			method: "POST",
			json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
		});
		const { result } = (await res.json()) as { result: { instructions: string } };
		expect(result.instructions).toContain("This token is a friend's");
	});
});

describe("the tokens page", () => {
	it("shows a friend only their own tokens, up to three", async () => {
		await using app = cfnotes();
		await app.token("write");
		const { path, id } = await app.open();
		await app.post(path, "share", { op: "invite", kind: "page", id, email: FRIEND });
		const friend = await app.as(FRIEND);

		const make = (name: string) =>
			friend.fetch("/tokens?__action=create", {
				method: "POST",
				headers: { "content-type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({ name, scope: "read" }),
			});
		for (const name of ["one", "two", "three"]) expect((await make(name)).status).toBe(200);
		const refused = await (await make("four")).text();
		expect(refused).toContain("You can have 3 tokens");

		const html = await (await friend.fetch("/tokens")).text();
		expect(html).toContain("reach only what's shared with you");
		expect(html.match(/class="trash-item token-item/g)?.length ?? 0).toBe(3);
		expect(html).not.toContain("owner@example.com");
	});
});

describe("a friend's limits", () => {
	/** Shares the first page with FRIEND, and makes them a token. */
	async function friendToken(app: App) {
		const { path, id } = await app.open();
		await app.post(path, "share", { op: "invite", kind: "page", id, email: FRIEND });
		return app.token("read", FRIEND);
	}
	const call = (method: string, params: object = {}) => ({
		method: "POST",
		json: { jsonrpc: "2.0", id: 1, method, params },
	});

	it("stops their tokens together after 60 requests a minute, over REST and MCP", async () => {
		await using app = cfnotes();
		const one = await friendToken(app);
		const two = await app.token("read", FRIEND);
		for (let i = 0; i < 30; i++) {
			expect((await app.api(one, "/api/v1/me")).status).toBe(200);
			expect((await app.api(two, "/api/mcp", call("ping"))).status).toBe(200);
		}
		const rest = await app.api(one, "/api/v1/me");
		expect(rest.status).toBe(429);
		expect(Number(rest.headers.get("retry-after"))).toBeGreaterThan(0);

		const ping = await app.api(two, "/api/mcp", call("ping"));
		expect(ping.status).toBe(429);
		const tool = await app.api(two, "/api/mcp", call("tools/call", { name: "list_pages" }));
		const { result } = (await tool.json()) as {
			result: { isError: boolean; content: { text: string }[] };
		};
		expect(result.isError).toBe(true);
		expect(result.content[0]!.text).toMatch(/^Too many requests: .* Try again in \d+ seconds\.$/);
	});

	it("doesn't limit an owner", async () => {
		await using app = cfnotes();
		const token = await app.token("read");
		for (let i = 0; i < 61; i++) expect((await app.api(token, "/api/v1/me")).status).toBe(200);
	});
});
