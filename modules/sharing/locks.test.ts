import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";
import { idIn, mcp } from "#modules/api/tools/testing.ts";

const FRIEND = "friend@example.com";
const DOC = JSON.stringify({ root: { children: [], type: "root", version: 1 } });

type App = ReturnType<typeof cfnotes>;

/** A folder "Trip" shared with FRIEND to edit, with a subfolder, a page and a database in it. */
async function setUp(app: App) {
	const owner = await mcp(app);
	const trip = (await owner("create_folder", { name: "Trip" })).data;
	const days = (await owner("create_folder", { name: "Days", parent_id: trip.id })).data;
	const plan = idIn((await owner("create_page", { title: "Plan", folder_id: trip.id })).text);
	const db = (await owner("create_database", { title: "Costs", folder_id: trip.id })).data;
	const { path } = await app.open();
	await app.post(path, "share", {
		op: "invite",
		kind: "folder",
		id: trip.id,
		email: FRIEND,
		role: "edit",
	});
	const friend = await app.as(FRIEND);
	return { owner, home: path, trip, days, plan, db, friend, agent: await mcp(app, FRIEND) };
}

describe("a locked page", () => {
	it("can be read and commented on by an editor, but not changed, moved or trashed", async () => {
		await using app = cfnotes();
		const { home, plan, friend, agent } = await setUp(app);
		const at = `/p/${plan}`;
		expect((await app.post(home, "lock", { kind: "page", id: plan, locked: true })).status).toBe(
			200,
		);

		const html = await (await friend.fetch(at)).text();
		expect(html).toContain('data-access="comment"');
		expect(html).toContain("page-locked");
		expect(html).not.toContain(">Delete</button>");
		expect(html).not.toMatch(/>\s*(Un)?lock\s*</);

		const saved = await friend.post(at, "save", { doc: DOC });
		expect(saved.status).toBe(403);
		expect(((await saved.json()) as { message: string }).message).toBe(
			'"Plan" is locked: only an owner can change it',
		);
		const comment = { op: "start", thread: crypto.randomUUID(), quote: null, body: "Hi" };
		expect((await friend.post(at, "comments", comment)).status).toBe(200);
		expect((await friend.post(home, "removePage", { id: plan })).status).toBe(403);
		expect((await friend.post(at, "remove", {})).status).toBe(403);
		expect((await agent("update_page", { page_id: plan, title: "X" })).text).toMatch(/is locked/);
		expect((await agent("trash_page", { page_id: plan })).text).toMatch(/is locked/);

		// Its owner may do anything, and unlocks it.
		const ownerView = await (await app.fetch(at)).text();
		expect(ownerView).toMatch(/>\s*Unlock\s*</);
		expect((await app.post(at, "save", { doc: DOC })).status).toBe(200);
		expect((await app.post(at, "lockPage", { locked: "false" })).status).toBe(303);
		expect((await friend.post(at, "save", { doc: DOC })).status).toBe(200);
	});

	it("locks a database's rows and properties", async () => {
		await using app = cfnotes();
		const { owner, db, agent } = await setUp(app);
		const row = idIn((await owner("create_page", { title: "Taxi", database_id: db.id })).text);
		await owner("update_page", { page_id: db.id, locked: true });
		const rows = await agent("create_rows", { database_id: db.id, rows: [{ title: "Bus" }] });
		expect(rows.text).toBe('Forbidden: "Costs" is locked: only an owner can change it');
		expect((await agent("update_page", { page_id: row, title: "Cab" })).text).toMatch(
			/"Costs" is locked/,
		);
		expect((await agent("update_database", { database_id: db.id, title: "Spend" })).error).toBe(
			true,
		);
		expect((await agent("read_page", { page_id: row })).structured?.lockedBy).toMatchObject({
			kind: "page",
			name: "Costs",
		});
	});

	it("can only be locked by an owner", async () => {
		await using app = cfnotes();
		const { home, plan, friend, agent } = await setUp(app);
		expect((await friend.post(home, "lock", { kind: "page", id: plan, locked: true })).status).toBe(
			403,
		);
		expect((await agent("update_page", { page_id: plan, locked: true })).text).toMatch(
			/^Forbidden/,
		);
	});
});

describe("a locked folder", () => {
	it("holds back an editor everywhere in it", async () => {
		await using app = cfnotes();
		const { owner, home, trip, days, plan, friend, agent } = await setUp(app);
		expect((await owner("update_folder", { folder_id: days.id, locked: true })).data.locked).toBe(
			true,
		);

		// The rest of the shared folder is theirs to change; the locked one isn't.
		expect((await friend.post(home, "create", { folder: trip.id })).status).toBe(303);
		expect((await friend.post(home, "create", { folder: days.id })).status).toBe(403);
		expect((await friend.post(home, "renameFolder", { id: days.id, name: "X" })).status).toBe(403);
		expect((await friend.post(home, "deleteFolder", { id: days.id })).status).toBe(403);
		expect(
			(await friend.post(home, "move", { kind: "folder", id: days.id, folderId: trip.id })).status,
		).toBe(403);
		expect(
			(await friend.post(home, "move", { kind: "page", id: plan, folderId: days.id })).status,
		).toBe(403);
		expect((await agent("create_page", { title: "Y", folder_id: days.id })).text).toBe(
			'Forbidden: It\'s in the locked folder "Days": only an owner can change it',
		);

		// Locking the shared folder itself holds back everything under it.
		await owner("update_folder", { folder_id: trip.id, locked: true });
		expect((await agent("update_page", { page_id: plan, title: "X" })).text).toMatch(
			/locked folder "Trip"/,
		);
		const html = await (await friend.fetch(`/p/${plan}`)).text();
		expect(html).toMatch(new RegExp(`data-folder="${trip.id}"\\s+data-editable=""`));
		expect(html).toContain('class="tree-lock"');
		expect(html).not.toContain("page-more");
		expect((await agent("list_folders", {})).data.folders).toEqual([
			expect.objectContaining({ id: days.id, locked: true, access: "comment" }),
			expect.objectContaining({ id: trip.id, locked: true, access: "comment" }),
		]);

		await owner("update_folder", { folder_id: trip.id, locked: false });
		expect((await agent("update_page", { page_id: plan, title: "X" })).error).toBe(false);
	});
});
