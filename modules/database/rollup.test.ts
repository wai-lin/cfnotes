import { describe, expect, it } from "vite-plus/test";

import { TITLE_COLUMN, type Column, type Row } from "./columns";
import { computeRollup, fnsFor, parseRollup } from "./rollup";

const title: Column = { id: TITLE_COLUMN, name: "Name", type: "title" };
const price: Column = { id: "p", name: "Price", type: "number" };
const due: Column = { id: "d", name: "Due", type: "date" };
const done: Column = { id: "c", name: "Done", type: "checkbox" };
const tags: Column = {
	id: "t",
	name: "Tags",
	type: "multi_select",
	options: [
		{ id: "a", name: "Red", color: "red" },
		{ id: "b", name: "Blue", color: "blue" },
	],
};
const row = (title: string, cells: Row["cells"] = {}): Row => ({ id: title, title, cells });
const rows = [
	row("One", { p: 10, d: "2026-03-01", c: true, t: ["a", "b"] }),
	row("Two", { p: 4, d: "2026-01-15", t: ["a"] }),
	row("", { p: 7 }),
];

describe("computeRollup", () => {
	it("shows the original values", () => {
		expect(computeRollup("show_original", title, rows)).toEqual(["One", "Two"]);
		expect(computeRollup("show_original", tags, rows)).toEqual(["Red", "Blue", "Red"]);
		expect(computeRollup("show_original", done, rows)).toEqual(["Yes", "No", "No"]);
	});

	it("counts", () => {
		expect(computeRollup("count_all", title, rows)).toBe(3);
		expect(computeRollup("count_values", tags, rows)).toBe(3);
		expect(computeRollup("count_unique", tags, rows)).toBe(2);
		expect(computeRollup("count_empty", title, rows)).toBe(1);
		expect(computeRollup("percent_not_empty", due, rows)).toBe(66.67);
		expect(computeRollup("percent_empty", due, [])).toBeNull();
	});

	it("does number maths", () => {
		expect(computeRollup("sum", price, rows)).toBe(21);
		expect(computeRollup("average", price, rows)).toBe(7);
		expect(computeRollup("median", price, rows.slice(0, 2))).toBe(7);
		expect(computeRollup("range", price, rows)).toBe(6);
		expect(computeRollup("min", price, [])).toBeNull();
	});

	it("does dates and checkboxes", () => {
		expect(computeRollup("earliest", due, rows)).toBe("2026-01-15");
		expect(computeRollup("latest", due, rows)).toBe("2026-03-01");
		expect(computeRollup("date_range", due, rows)).toBe(45);
		expect(computeRollup("checked", done, rows)).toBe(1);
		expect(computeRollup("percent_unchecked", done, rows)).toBe(66.67);
	});
});

describe("rollup settings", () => {
	it("offers calculations that fit the property", () => {
		expect(fnsFor("number")).toContain("sum");
		expect(fnsFor("text")).not.toContain("sum");
		expect(fnsFor("date")).toContain("earliest");
		expect(fnsFor("checkbox")).toContain("percent_checked");
	});

	it("parses only complete settings", () => {
		expect(parseRollup({ relationId: "r", targetId: "title", fn: "sum" })).toEqual({
			relationId: "r",
			targetId: "title",
			fn: "sum",
		});
		expect(parseRollup({ relationId: "r", targetId: "title", fn: "bogus" })).toBeNull();
		expect(parseRollup({ relationId: "r", targetId: "title", fn: "toString" })).toBeNull();
	});
});
