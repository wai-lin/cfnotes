import { describe, expect, it } from "vitest";

import { filterItems, SLASH_TRIGGER } from "./logic.ts";

const items = [
	{ label: "Text", keywords: "text paragraph plain" },
	{ label: "Table", keywords: "table grid rows columns", hiddenIn: ["table"] },
	{ label: "Web bookmark", keywords: "bookmark link card" },
	{ label: "Link to page", keywords: "link page mention" },
	{ label: "2 columns", keywords: "columns layout", hiddenIn: ["table", "column"] },
];

describe("filterItems", () => {
	it("keeps the order with no query", () => {
		expect(filterItems(items, "", []).map((i) => i.label)).toEqual(items.map((i) => i.label));
	});

	it("puts names starting with the query before keyword matches", () => {
		expect(filterItems(items, "link", []).map((i) => i.label)).toEqual([
			"Link to page",
			"Web bookmark",
		]);
	});

	it("matches keywords too", () => {
		expect(filterItems(items, "grid", []).map((i) => i.label)).toEqual(["Table"]);
	});

	it("leaves out what can't go in the caret's container", () => {
		expect(filterItems(items, "", ["table"]).map((i) => i.label)).toEqual([
			"Text",
			"Web bookmark",
			"Link to page",
		]);
		expect(filterItems(items, "col", ["column"]).map((i) => i.label)).toEqual(["Table"]);
	});
});

describe("SLASH_TRIGGER", () => {
	const query = (text: string) => SLASH_TRIGGER.pattern.exec(text)?.[1] ?? null;

	it("opens at a line start or after a space", () => {
		expect(query("/")).toBe("");
		expect(query("hello /hea")).toBe("hea");
	});

	it("ignores slashes inside words and long queries", () => {
		expect(query("and/or")).toBeNull();
		expect(query(`/${"x".repeat(25)}`)).toBeNull();
	});
});
