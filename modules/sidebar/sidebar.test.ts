import { form } from "spacefn/testing";
import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

const folderId = (tree: string) => /data-folder="([^"]+)"/.exec(tree)![1]!;

describe("sidebar", () => {
	it("creates, deletes and brings back a folder with what was in it", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const folder = folderId(await (await app.post(path, "newFolder", { name: "Work" })).text());
		const moved = await app.post(path, "move", { kind: "page", id, folderId: folder });
		expect(moved.status).toBe(200);

		const deleted = await app.post(path, "deleteFolder", { id: folder });
		const undo = JSON.parse(decodeURIComponent(deleted.headers.get("x-undo")!));
		expect(undo).toMatchObject({ id: folder, name: "Work", pages: [id] });
		expect(await deleted.text()).not.toContain("data-folder=");

		const back = await (await app.post(path, "restoreFolder", undo)).text();
		expect(folderId(back)).toBe(folder);
		// The page is inside it again: after the folder's row, not at the top level.
		expect(back).not.toContain("folder-empty");
		expect((await app.post(path, "restoreFolder", undo)).status).toBe(409);
	});

	it("answers tree actions with the tree alone", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const tree = await (await app.post(path, "newFolder", { name: "Work" })).text();
		expect(tree).not.toContain("<!doctype");
	});

	it("won't put a folder inside itself", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const folder = folderId(await (await app.post(path, "newFolder", { name: "Work" })).text());
		const move = { kind: "folder", id: folder, folderId: folder };
		expect((await app.post(path, "move", move)).status).toBe(400);
	});

	it("reorders pages", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const made = await app.fetch(`${path}?__action=create`, form({}));
		const second = made.headers.get("location")!.split("/").pop()!;
		const body = { id: second, folderId: null, beforeId: id };
		const tree = await (await app.post(path, "reorder", body)).text();
		expect(tree.indexOf(second)).toBeLessThan(tree.indexOf(id));
	});

	it("works from the Trash page, and says why Undo failed", async () => {
		await using app = cfnotes();
		const { id } = await app.open();
		expect((await app.post("/trash", "removePage", { id })).status).toBe(200);
		expect((await app.post("/trash", "restorePage", { id })).status).toBe(200);
		const again = await app.post("/trash", "restorePage", { id });
		expect(again.status).toBe(409);
		expect(await again.json()).toMatchObject({ message: "That item isn't in Trash any more." });
	});
});
