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

describe("a friend in a folder shared to edit", () => {
	/** A folder shared with FRIEND as `role`, with a subfolder and a page in each. */
	async function setUp(app: App, role = "edit") {
		const { path } = await app.open();
		const outside = await newFolder(app, path, "Mine");
		const folder = await newFolder(app, path, "Trip");
		const sub = await newFolder(app, path, "Days", folder);
		const page = await newPage(app, path, folder);
		await share(app, path, { kind: "folder", id: folder, role });
		const friend = await app.as(FRIEND);
		return { home: path, outside, folder, sub, page, friend };
	}

	it("makes pages, databases and folders in it, which its share covers", async () => {
		await using app = cfnotes();
		const { folder, sub, page, friend } = await setUp(app);

		const made = await friend.post(page.path, "create", { folder: sub });
		expect(made.status).toBe(303);
		const madePath = made.headers.get("location")!;
		expect(await (await friend.fetch(madePath)).text()).toContain('data-access="edit"');
		const db = await friend.post(page.path, "createDatabase", { folder });
		expect((await friend.fetch(db.headers.get("location")!)).status).toBe(200);

		const tree = await (
			await friend.post(page.path, "newFolder", { name: "Food", parentId: sub })
		).text();
		expect(tree).toContain('class="folder-name">Food<');
		// The tree it answers with is theirs, not the whole workspace.
		expect(tree).not.toContain("Mine");
		expect(tree).toContain(`href="${madePath}"`);
	});

	it("renames, moves and trashes inside it, and no further", async () => {
		await using app = cfnotes();
		const { home, outside, folder, sub, page, friend } = await setUp(app);
		const at = page.path;

		expect((await friend.post(at, "renameFolder", { id: sub, name: "Nights" })).status).toBe(200);
		expect((await friend.post(at, "renameFolder", { id: folder, name: "Ours" })).status).toBe(200);
		expect(
			(await friend.post(at, "move", { kind: "page", id: page.id, folderId: sub })).status,
		).toBe(200);
		expect(
			(await friend.post(at, "reorder", { id: page.id, folderId: folder, beforeId: null })).status,
		).toBe(200);

		// Not out of it, nor the shared folder itself, nor into the owner's.
		for (const folderId of [null, outside])
			expect(
				(await friend.post(at, "move", { kind: "page", id: page.id, folderId })).status,
				String(folderId),
			).toBeGreaterThanOrEqual(403);
		expect(
			(await friend.post(at, "move", { kind: "folder", id: folder, folderId: sub })).status,
		).toBe(403);
		expect((await friend.post(at, "deleteFolder", { id: folder })).status).toBe(403);
		expect((await friend.post(at, "create", {})).status).toBe(403);
		expect((await friend.post(at, "create", { folder: outside })).status).toBe(404);
		expect((await friend.post(at, "newFolder", { name: "X", parentId: null })).status).toBe(403);
		expect((await friend.post(at, "renameFolder", { id: outside, name: "X" })).status).toBe(404);

		// The page's Delete, and the sidebar's, with Undo.
		expect(await (await friend.fetch(at)).text()).toContain(">Delete</button>");
		expect((await friend.post(at, "removePage", { id: page.id })).status).toBe(200);
		expect((await friend.post(home, "restorePage", { id: page.id })).status).toBe(200);
		expect((await friend.post(at, "remove", {})).status).toBe(303);
		expect((await friend.fetch(at)).status).toBe(302);

		const deleted = await friend.post(home, "deleteFolder", { id: sub });
		expect(deleted.status).toBe(200);
		const undo = decodeURIComponent(deleted.headers.get("x-undo")!);
		expect((await friend.post(home, "restoreFolder", JSON.parse(undo))).status).toBe(200);
	});

	it("shows them the folder's menus, but not a viewer", async () => {
		await using app = cfnotes();
		const editor = await setUp(app);
		const html = await (await editor.friend.fetch(editor.page.path)).text();
		expect(html).toMatch(
			new RegExp(`data-folder="${editor.folder}"\\s+data-editable="true"\\s+data-movable=""`),
		);
		expect(html).toMatch(
			new RegExp(`data-folder="${editor.sub}"\\s+data-editable="true"\\s+data-movable="true"`),
		);
		expect(html).toContain('id="new-page-form"');
		expect(html).not.toContain("New folder");

		await share(app, editor.home, {
			kind: "folder",
			id: editor.folder,
			op: "setRole",
			role: "view",
		});
		const viewer = await (await editor.friend.fetch(editor.page.path)).text();
		expect(viewer).toMatch(new RegExp(`data-folder="${editor.folder}"\\s+data-editable=""`));
		expect(viewer).not.toContain("folder-more");
		expect(viewer).not.toContain(">Delete</button>");
		expect(
			(await editor.friend.post(editor.page.path, "create", { folder: editor.folder })).status,
		).toBe(403);
		expect(
			(await editor.friend.post(editor.page.path, "removePage", { id: editor.page.id })).status,
		).toBe(403);
	});

	it("leaves a page shared on its own where it is", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		await share(app, path, { kind: "page", id, role: "edit" });
		const friend = await app.as(FRIEND);
		expect((await friend.post(path, "removePage", { id })).status).toBe(403);
		expect(await (await friend.fetch(path)).text()).not.toContain(">Delete</button>");
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
