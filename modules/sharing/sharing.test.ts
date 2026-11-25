import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

const FRIEND = "friend@example.com";
const DOC = JSON.stringify({ root: { children: [], type: "root", version: 1 } });

type App = ReturnType<typeof cfnotes>;

/** Shares a page or folder from the owner's side; the people it's shared with. */
async function share(
	app: App,
	from: string,
	body: { kind: "page" | "folder"; id: string; op?: string; email?: string; role?: string },
) {
	const res = await app.post(from, "share", { op: "invite", email: FRIEND, ...body });
	return {
		status: res.status,
		body: (await res.json()) as { people?: unknown[]; message?: string },
	};
}

/** A new page, made by the owner from the sidebar: its path and id. */
async function newPage(app: App, from: string, folder?: string) {
	const res = await app.post(from, "create", folder ? { folder } : {});
	const path = res.headers.get("location")!;
	return { path, id: path.split("/").pop()! };
}

/** A new folder at the top level: its id. */
async function newFolder(app: App, from: string, name: string, parentId?: string) {
	const res = await app.post(from, "newFolder", { name, parentId });
	const tree = await res.text();
	const ids = [...tree.matchAll(/data-folder="([^"]+)"/g)].map((m) => m[1]!);
	const names = [...tree.matchAll(/class="folder-name">([^<]+)</g)].map((m) => m[1]!);
	return ids[names.indexOf(name)]!;
}

describe("sharing a page", () => {
	it("lets someone in only once something is shared with them", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		expect((await app.as(FRIEND)).signedIn).toBe(false);

		expect((await share(app, path, { kind: "page", id })).body.people).toEqual([
			{ email: FRIEND, role: "view", createdAt: expect.any(Number) },
		]);
		const friend = await app.as(FRIEND);
		expect(friend.signedIn).toBe(true);
		expect((await friend.fetch("/")).headers.get("location")).toBe(path);

		// Taking the share away signs them out.
		await share(app, path, { kind: "page", id, op: "remove" });
		expect((await friend.fetch(path)).status).toBe(401);
	});

	it("shows a viewer the page, read-only, and nothing else", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const other = await newPage(app, path);
		await share(app, path, { kind: "page", id });
		const friend = await app.as(FRIEND);

		const html = await (await friend.fetch(path)).text();
		expect(html).toContain('data-access="view"');
		expect(html).toContain('readonly="true"');
		expect(html).toContain("View only");
		expect(html).not.toContain("page-share");
		expect(html).not.toContain(`/p/${other.id}`);
		expect(html).not.toContain("New page");

		expect((await friend.post(path, "save", { doc: DOC })).status).toBe(403);
		expect((await friend.post(path, "title", { title: "Mine now" })).status).toBe(403);
		expect((await friend.post(path, "comments", { op: "list" })).status).toBe(200);
		const comment = { op: "start", thread: crypto.randomUUID(), quote: null, body: "Hi" };
		expect((await friend.post(path, "comments", comment)).status).toBe(403);

		// Another page is as good as missing, and the rest of the app is the owner's.
		expect((await friend.fetch(other.path)).status).toBe(404);
		expect((await friend.post(other.path, "comments", { op: "list" })).status).toBe(404);
		for (const route of ["/trash", "/search?q=x", "/tokens", "/archive"])
			expect((await friend.fetch(route)).status, route).toBe(403);
		expect((await friend.post(path, "create", {})).status).toBe(403);
		expect((await friend.post(path, "share", { op: "list", kind: "page", id })).status).toBe(403);
		expect((await friend.post(path, "remove", {})).status).toBe(403);
	});

	it("lets a commenter comment on the page, but not mark its text", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		await share(app, path, { kind: "page", id, role: "comment" });
		const friend = await app.as(FRIEND);

		const onPage = { op: "start", thread: crypto.randomUUID(), quote: null, body: "Nice" };
		expect((await friend.post(path, "comments", onPage)).status).toBe(200);
		const onText = { op: "start", thread: crypto.randomUUID(), quote: "some text", body: "Hm" };
		expect((await friend.post(path, "comments", onText)).status).toBe(403);
		expect((await friend.post(path, "save", { doc: DOC })).status).toBe(403);
	});

	it("lets an editor edit and add pages, which stay shared with them", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		await share(app, path, { kind: "page", id, role: "edit" });
		const friend = await app.as(FRIEND);

		expect((await friend.post(path, "save", { doc: DOC })).status).toBe(200);
		const made = await friend.post(path, "linkPage", { title: "Their notes" });
		expect(made.status).toBe(200);
		const { id: newId } = (await made.json()) as { id: string };
		const html = await (await friend.fetch(`/p/${newId}`)).text();
		expect(html).toContain('data-access="edit"');

		// Uploads are theirs too; deleting and sharing stay the owner's.
		expect((await friend.post(path, "remove", {})).status).toBe(403);
		const people = await share(app, path, { kind: "page", id: newId, op: "list" });
		expect(people.body.people).toEqual([expect.objectContaining({ email: FRIEND, role: "edit" })]);
	});

	it("covers a database's rows", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const db = await app.post(path, "createDatabase", {});
		const dbPath = db.headers.get("location")!;
		const dbId = dbPath.split("/").pop()!;
		await share(app, path, { kind: "page", id: dbId, role: "edit" });
		const friend = await app.as(FRIEND);

		const added = await friend.post(dbPath, "dbOp", { op: "addRow", databaseId: dbId });
		expect(added.status).toBe(200);
		const { state } = (await added.json()) as { state: { rows: { id: string }[] } };
		expect((await friend.fetch(`/p/${state.rows[0]!.id}`)).status).toBe(200);
		expect((await friend.post(dbPath, "dbOp", { op: "delete", databaseId: dbId })).status).toBe(
			403,
		);
	});
});

describe("sharing a folder", () => {
	it("covers what's in it and its subfolders, in the friend's sidebar", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const folder = await newFolder(app, path, "Trip");
		const sub = await newFolder(app, path, "Days", folder);
		const inFolder = await newPage(app, path, folder);
		const inSub = await newPage(app, path, sub);
		await share(app, path, { kind: "folder", id: folder });
		const friend = await app.as(FRIEND);

		const html = await (await friend.fetch(inFolder.path)).text();
		expect(html).toContain("Shared with you");
		expect(html).toContain(`data-folder="${folder}"`);
		expect(html).toContain(`/p/${inSub.id}`);
		expect(html).not.toContain(`/p/${(await app.open()).id}"`);
		expect((await friend.fetch(inSub.path)).status).toBe(200);
		expect((await friend.fetch(path)).status).toBe(404);
	});
});

describe("the Share dialog", () => {
	it("refuses a bad email and the owners themselves", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		expect((await share(app, path, { kind: "page", id, email: "nope" })).body.message).toBe(
			"invalid_email",
		);
		const owner = await share(app, path, { kind: "page", id, email: "Owner@Example.com" });
		expect(owner.body.message).toBe("already_owner");
	});

	it("changes a role, and keeps emails in one case", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		await share(app, path, { kind: "page", id, email: "Friend@Example.com" });
		const changed = await share(app, path, { kind: "page", id, op: "setRole", role: "edit" });
		expect(changed.body.people).toEqual([expect.objectContaining({ email: FRIEND, role: "edit" })]);
		const friend = await app.as("FRIEND@example.com");
		expect(await (await friend.fetch(path)).text()).toContain('data-access="edit"');
	});
});
