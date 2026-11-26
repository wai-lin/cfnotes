import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { idIn, mcp, type Json } from "./testing.ts";

describe("organizing pages over MCP", () => {
	it("makes, renames, nests and deletes folders, and moves pages into them", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: blog } = await call("create_folder", { name: "Blog" });
		expect(blog).toMatchObject({ name: "Blog", parentId: null, path: "Blog" });
		const { data: drafts } = await call("create_folder", { name: "Draft", parent_id: blog.id });
		expect(drafts.path).toBe("Blog/Draft");
		const renamed = await call("update_folder", { folder_id: drafts.id, name: "Drafts" });
		expect(renamed.data.path).toBe("Blog/Drafts");

		const a = idIn((await call("create_page", { title: "A" })).text);
		const b = idIn((await call("create_page", { title: "B" })).text);
		await call("move_page", { page_id: a, folder_id: drafts.id });
		const moved = await call("move_page", { page_id: b, folder_id: drafts.id, before_page_id: a });
		expect(moved.data).toMatchObject({ id: b, folder: { path: "Blog/Drafts" } });
		const pages = await call("list_pages", {});
		expect(
			(pages.data.pages as Json[]).filter((p) => p.folder === "Blog/Drafts").map((p) => p.title),
		).toEqual(["B", "A"]);

		// A folder can't go inside itself; to the top level is fine.
		expect((await call("update_folder", { folder_id: blog.id, parent_id: drafts.id })).text).toBe(
			"BadRequest: A folder can't go inside itself",
		);
		expect((await call("update_folder", { folder_id: drafts.id, parent_id: null })).data.path).toBe(
			"Drafts",
		);

		// Deleting a folder moves what's in it up a level.
		const deleted = await call("delete_folder", { folder_id: drafts.id });
		expect(deleted.data.movedUp).toEqual({ pages: 2, folders: 0 });
		const after = (await call("list_pages", {})).data.pages as Json[];
		expect(after.find((p) => p.id === a)?.folder).toBeNull();
	});

	it("doesn't move rows or inline databases into folders", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", { title: "Tasks" });
		const row = idIn((await call("create_page", { title: "One", database_id: db.id })).text);
		expect((await call("move_page", { page_id: row, folder_id: null })).text).toContain(
			"lives in its database",
		);
		// But a full-page database moves like a page.
		const { data: folder } = await call("create_folder", { name: "Work" });
		expect((await call("move_page", { page_id: db.id, folder_id: folder.id })).error).toBe(false);
		expect((await call("move_page", { page_id: db.id, folder_id: crypto.randomUUID() })).text).toBe(
			"NotFound: No such folder",
		);
	});
});

describe("Trash over MCP", () => {
	it("lists what's trashed and restores it with what went with it", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const { data: db } = await call("create_database", { title: "Reading" });
		const row = idIn((await call("create_page", { title: "Dune", database_id: db.id })).text);
		const page = idIn((await call("create_page", { title: "Notes" })).text);
		await call("trash_page", { page_id: page });
		await call("trash_page", { page_id: db.id });

		// Newest first; both may be trashed in the same millisecond, so compare by title.
		const trash = ((await call("list_trash", {})).data as unknown as Json[]).toSorted((a, b) =>
			String(a.title).localeCompare(String(b.title)),
		);
		expect(trash.map((t) => [t.title, t.kind, t.with])).toEqual([
			["Notes", "page", 0],
			["Reading", "database", 1],
		]);
		expect(trash[0]!.deletedForGoodAt > trash[0]!.trashedAt).toBe(true);

		// The row went with its database, so it comes back with it.
		expect((await call("restore_page", { page_id: row })).text).toContain("restore that");
		expect((await call("restore_page", { page_id: db.id })).text).toBe("Restored.");
		expect((await call("read_page", { page_id: row })).text).toContain("# Dune");
		expect((await call("restore_page", { page_id: db.id })).text).toBe(
			"BadRequest: That item isn't in Trash any more.",
		);
		expect((await call("list_trash", {})).data).toHaveLength(1);
	});
});
