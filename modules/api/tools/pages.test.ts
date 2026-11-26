import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { idIn, mcp, type App } from "./testing.ts";

const DOC = `# Trip

Intro.

## Packing

- Tent
- Stove

### Food

Pasta.

## Route

Day one: the **coast** road.`;

/** A page with DOC, and a way to edit it and read back its Markdown. */
async function trip(app: App) {
	const call = await mcp(app);
	const id = idIn((await call("create_page", { title: "Trip", markdown: DOC })).text);
	const edit = async (edits: object[]) => {
		const res = await call("edit_page", { page_id: id, edits });
		return res.error ? res.text : res.text.slice(res.text.indexOf("```\n\n") + 5);
	};
	return { id, edit, call };
}

describe("editing part of a page over MCP", () => {
	it("replaces, adds to and deletes a heading's section", async () => {
		await using app = cfnotes();
		const { edit } = await trip(app);
		// A section runs to the next heading of its level or higher, so Food is part of Packing.
		expect(await edit([{ action: "replace_section", heading: "Packing", markdown: "- Bag" }])).toBe(
			"# Trip\n\nIntro.\n\n## Packing\n\n- Bag\n\n## Route\n\nDay one: the **coast** road.",
		);
		expect(
			await edit([
				{ action: "append_to_section", heading: "packing", markdown: "- Map" },
				{ action: "insert_after", heading: "## Route", markdown: "Start early." },
				{ action: "insert_before", heading: "Route", markdown: "## Budget\n\nCheap." },
				{ action: "delete_section", heading: "Budget" },
			]),
		).toBe(
			"# Trip\n\nIntro.\n\n## Packing\n\n- Bag\n- Map\n\n## Route\n\nStart early.\n\nDay one: the **coast** road.",
		);
	});

	it("finds and replaces text, keeping its formatting", async () => {
		await using app = cfnotes();
		const { edit } = await trip(app);
		expect(await edit([{ action: "replace_text", find: "coast", replace: "mountain" }])).toContain(
			"the **mountain** road",
		);
		expect(await edit([{ action: "replace_text", find: "o", replace: "0" }])).toContain(
			'"o" is in the page',
		);
		expect(
			await edit([{ action: "replace_text", find: "Day", replace: "Night", all: true }]),
		).toContain("Night one");
	});

	it("changes nothing when an edit fails, and says why", async () => {
		await using app = cfnotes();
		const { id, edit, call } = await trip(app);
		const failed = await edit([
			{ action: "replace_section", heading: "Route", markdown: "Gone." },
			{ action: "delete_section", heading: "Weather" },
		]);
		expect(failed).toBe(
			'BadRequest: Edit 2 of 2 (delete_section): No heading "Weather"; the page\'s headings are "# Trip", "## Packing", "### Food", "## Route". Nothing was changed.',
		);
		expect((await call("read_page", { page_id: id })).text).toContain("Day one");

		await call("edit_page", {
			page_id: id,
			edits: [{ action: "insert_before", heading: "Route", markdown: "## Packing\n\nAgain." }],
		});
		expect(await edit([{ action: "delete_section", heading: "Packing" }])).toContain(
			'2 headings say "Packing": give occurrence',
		);
		expect(
			await edit([{ action: "delete_section", heading: "Packing", occurrence: 2 }]),
		).not.toContain("Again.");
	});
});

describe("comments over MCP", () => {
	it("comments on quoted text, marking it as the editor does", async () => {
		await using app = cfnotes();
		const { id, call } = await trip(app);
		const res = await call("add_comment", { page_id: id, body: "Which coast?", quote: "coast" });
		expect(res.data).toMatchObject({ quote: "coast", comments: [{ body: "Which coast?" }] });

		const doc = (await (
			await app.api(await app.token("read"), `/api/v1/pages/${id}?format=json`)
		).json()) as {
			content: string;
		};
		const marks = JSON.stringify(doc.content).match(/"type":"mark"[^}]*"ids":\["([^"]+)"\]/);
		expect(marks?.[1]).toBe(res.data.id);
		// The text reads the same; only the mark is new.
		expect((await call("read_page", { page_id: id })).text).toContain("the **coast** road");

		const missing = await call("add_comment", { page_id: id, body: "?", quote: "desert" });
		expect(missing.text).toContain(`"desert" isn't in the page's text`);
		const twice = await call("add_comment", { page_id: id, body: "?", quote: "o" });
		expect(twice.text).toContain("quote more of it");
		expect((await call("read_page", { page_id: id })).text.match(/"body":/g)).toHaveLength(1);
	});

	it("resolves and reopens threads, and edits and deletes comments", async () => {
		await using app = cfnotes();
		const { id, call } = await trip(app);
		const { data: thread } = await call("add_comment", { page_id: id, body: "First" });
		const resolved = await call("resolve_thread", { page_id: id, thread_id: thread.id });
		expect(resolved.data.resolvedAt).not.toBeNull();
		const reopened = await call("resolve_thread", {
			page_id: id,
			thread_id: thread.id,
			resolved: false,
		});
		expect(reopened.data.resolvedAt).toBeNull();

		const comment = thread.comments[0].id as string;
		expect(
			(await call("edit_comment", { page_id: id, comment_id: comment, body: "Second" })).text,
		).toBe("Edited the comment.");
		expect((await call("read_page", { page_id: id })).text).toContain('"body": "Second"');
		expect((await call("edit_comment", { page_id: id, comment_id: comment, body: " " })).text).toBe(
			"BadRequest: A comment can't be empty",
		);
		expect((await call("delete_comment", { page_id: id, comment_id: comment })).text).toBe(
			"Deleted the comment.",
		);
		expect((await call("read_page", { page_id: id })).text).not.toContain("## Comments");
		expect((await call("resolve_thread", { page_id: id, thread_id: thread.id })).text).toBe(
			"NotFound: No such thread",
		);
	});
});

describe("a page's details over MCP", () => {
	it("sets and removes covers", async () => {
		await using app = cfnotes();
		const { id, call } = await trip(app);
		expect((await call("update_page", { page_id: id, cover: "g3" })).text).toContain(
			'"cover": "g3"',
		);
		const image = await call("update_page", {
			page_id: id,
			cover: "http://localhost:1337/api/v1/files/img/photo.jpg",
		});
		expect(image.text).toContain('"cover": "http://localhost:1337/api/v1/files/img/photo.jpg"');
		expect((await call("update_page", { page_id: id, cover: "" })).text).not.toContain('"cover"');
		expect(
			(await call("update_page", { page_id: id, cover: "https://example.com/a.png" })).text,
		).toContain("A cover is g1 to g6");
	});

	it("says which pages link to a page", async () => {
		await using app = cfnotes();
		const { id, call } = await trip(app);
		const from = idIn(
			(await call("create_page", { title: "Index", markdown: `See [Trip](/p/${id}).` })).text,
		);
		const read = await call("read_page", { page_id: id });
		expect(read.text).toContain(
			`"linkedFrom": [\n    {\n      "id": "${from}",\n      "title": "Index"`,
		);
	});
});
