import { form } from "spacefn/testing";
import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { MAX_CONTENT_BYTES } from "./pages.ts";

const doc = (...texts: string[]) =>
	JSON.stringify({
		root: {
			type: "root",
			children: texts.map((text) => ({ type: "paragraph", children: [{ type: "text", text }] })),
		},
	});

describe("pages", () => {
	it("makes the first page, and keeps the query on the way to it", async () => {
		await using app = cfnotes();
		const first = await app.fetch("/?trashed=x&title=Old");
		expect(first.status).toBe(302);
		expect(first.headers.get("location")).toMatch(/^\/p\/[0-9a-f-]{36}\?trashed=x&title=Old$/);
		const { path } = await app.open();
		expect(await (await app.fetch(path)).text()).toContain("<notes-editor");
	});

	it("saves the document and finds it by its text", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const saved = await app.post(path, "save", { doc: doc("a quokka appears") });
		expect(saved.headers.get("content-type")).toBe("text/event-stream");
		expect(await saved.text()).toContain('signals {"_saving":false}');
		expect(await (await app.fetch(path)).text()).toContain("a quokka appears");
		const found = (await (await app.fetch("/search?q=quokka")).json()) as {
			results: { id: string }[];
		};
		expect(found.results.map((result) => result.id)).toEqual([id]);
	});

	it("takes a note near the size limit, though it's over 1 MiB once escaped", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const large = doc('"'.repeat(MAX_CONTENT_BYTES / 2 - 200));
		expect(JSON.stringify({ doc: large }).length).toBeGreaterThan(1024 * 1024);
		expect((await app.post(path, "save", { doc: large })).status).toBe(200);
		const over = doc("x".repeat(MAX_CONTENT_BYTES));
		expect((await app.post(path, "save", { doc: over })).status).toBe(413);
	});

	it("refuses what isn't a document", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		expect((await app.post(path, "save", { doc: "not json" })).status).toBe(400);
		expect((await app.post(path, "save", { doc: '{"no":"root"}' })).status).toBe(400);
		expect((await app.post(path, "save", {})).status).toBe(422);
	});

	it("patches the sidebar link on a rename, escaping the title", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const patch = await (await app.post(path, "title", { title: "  <b>Plans</b> " })).text();
		expect(patch).toContain("event: datastar-patch-elements");
		expect(patch).toContain(`id="nav-${id}"`);
		expect(patch).toContain("&lt;b&gt;Plans&lt;/b&gt;");
	});

	it("lists backlinks from what was saved", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const made = (await (await app.post(path, "linkPage", { title: "Target" })).json()) as {
			id: string;
			tree: string;
		};
		expect(made.tree).toContain("Target");
		const linked = JSON.stringify({
			root: { type: "root", children: [{ type: "page-link", pageId: made.id }] },
		});
		await app.post(path, "save", { doc: linked });
		const target = await (await app.fetch(`/p/${made.id}`)).text();
		expect(target).toContain("Linked from 1");
		expect(target).toContain(`href="/p/${id}"`);
	});

	it("takes only known covers", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		expect(await (await app.post(path, "cover", { cover: "g3" })).json()).toMatchObject({
			cover: "g3",
		});
		expect((await app.post(path, "cover", { cover: "javascript:x" })).status).toBe(422);
	});

	it("deletes to Trash, and opens Trash for a trashed page", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const gone = await app.fetch(`${path}?__action=remove`, form({}));
		expect(gone.status).toBe(303);
		expect(gone.headers.get("location")).toContain(`trashed=${id}`);
		expect((await app.fetch(path)).headers.get("location")).toBe("/trash");
		expect((await app.post(path, "save", { doc: doc("late") })).status).toBe(404);
		expect(await (await app.fetch("/trash")).text()).toContain(`id="trash-${id}"`);
	});

	it("404s an id that isn't one, or isn't there", async () => {
		await using app = cfnotes();
		expect((await app.fetch("/p/nope")).status).toBe(404);
		expect((await app.fetch(`/p/${crypto.randomUUID()}`)).status).toBe(404);
	});

	it("refuses another site's posts", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const cross = await app.fetch(
			`${path}?__action=remove`,
			form({}, { headers: { origin: "https://elsewhere.example" } }),
		);
		expect(cross.status).toBe(403);
	});
});
