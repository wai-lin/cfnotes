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
