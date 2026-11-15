import { describe, expect, it } from "vite-plus/test";

import { TITLE_COLUMN, type Column, type Row } from "./columns";
import { applyView, cleanView, matches, newView, prefill, type Filter } from "./view";

const columns: Column[] = [
	{ id: TITLE_COLUMN, name: "Name", type: "title" },
	{ id: "n", name: "Price", type: "number" },
	{
		id: "s",
		name: "Status",
		type: "select",
		options: [
			{ id: "todo", name: "Todo", color: "gray" },
			{ id: "done", name: "Done", color: "green" },
		],
	},
	{
		id: "m",
		name: "Tags",
		type: "multi_select",
		options: [
			{ id: "a", name: "A", color: "blue" },
			{ id: "b", name: "B", color: "red" },
		],
	},
	{ id: "d", name: "Due", type: "date" },
	{ id: "c", name: "Done", type: "checkbox" },
];
const col = (id: string) => columns.find((c) => c.id === id)!;
const row = (id: string, title: string, cells: Row["cells"] = {}): Row => ({ id, title, cells });
const rows = [
	row("1", "banana", { n: 3, s: "done", m: ["a"], d: "2026-01-10", c: true }),
	row("2", "Apple", { n: 10, s: "todo", m: ["a", "b"] }),
	row("3", "", { n: 3, d: "2026-03-01" }),
	row("4", "cherry 2", { s: "todo" }),
	row("5", "cherry 10", { n: -1 }),
];
const ids = (list: Row[]) => list.map((r) => r.id).join("");
const f = (columnId: string, op: string, value?: string | number): Filter => ({
	id: "f",
	columnId,
	op,
	...(value === undefined ? {} : { value }),
});

describe("matches", () => {
	const keep = (filter: Filter) =>
		ids(rows.filter((r) => matches(col(filter.columnId), r, filter)));

	it("text, case-insensitively", () => {
		expect(keep(f(TITLE_COLUMN, "contains", "AN"))).toBe("1");
		expect(keep(f(TITLE_COLUMN, "starts_with", "cherry"))).toBe("45");
		expect(keep(f(TITLE_COLUMN, "empty"))).toBe("3");
		expect(keep(f(TITLE_COLUMN, "is", "apple"))).toBe("2");
	});

	it("numbers, dates, selects, checkboxes", () => {
		expect(keep(f("n", "gte", 3))).toBe("123");
		expect(keep(f("n", "neq", 3))).toBe("245");
		expect(keep(f("n", "empty"))).toBe("4");
		expect(keep(f("d", "before", "2026-02-01"))).toBe("1");
		expect(keep(f("s", "is", "todo"))).toBe("24");
		expect(keep(f("s", "is_not", "todo"))).toBe("135");
		expect(keep(f("m", "contains", "b"))).toBe("2");
		expect(keep(f("m", "not_contains", "a"))).toBe("345");
		expect(keep(f("c", "checked"))).toBe("1");
	});

	it("a filter still waiting for its value matches everything", () => {
		expect(keep(f("n", "gt"))).toBe("12345");
	});
});

describe("applyView", () => {
	it("sorts naturally, with empties last in both directions", () => {
		expect(
			ids(
				applyView(columns, rows, {
					sorts: [{ columnId: TITLE_COLUMN, direction: "asc" }],
					filters: [],
				}),
			),
		).toBe("21453");
		expect(
			ids(
				applyView(columns, rows, {
					sorts: [{ columnId: TITLE_COLUMN, direction: "desc" }],
					filters: [],
				}),
			),
		).toBe("54123");
	});

	it("uses later sorts to break ties and keeps stored order otherwise", () => {
		const view = {
			sorts: [
				{ columnId: "n", direction: "asc" as const },
				{ columnId: TITLE_COLUMN, direction: "desc" as const },
			],
			filters: [],
		};
		expect(ids(applyView(columns, rows, view))).toBe("51324");
	});

	it("sorts selects by option order", () => {
		expect(
			ids(applyView(columns, rows, { sorts: [{ columnId: "s", direction: "asc" }], filters: [] })),
		).toBe("24135");
	});

	it("ANDs filters, and always shows kept rows", () => {
		const view = { sorts: [], filters: [f("n", "eq", 3), f(TITLE_COLUMN, "not_empty")] };
		expect(ids(applyView(columns, rows, view))).toBe("1");
		expect(ids(applyView(columns, rows, view, new Set(["4"])))).toBe("14");
	});
});

describe("cleanView", () => {
	it("drops sorts and filters that no longer fit the columns", () => {
		const view = cleanView(
			JSON.stringify({
				sorts: [
					{ columnId: "gone", direction: "asc" },
					{ columnId: "n", direction: "sideways" },
					{ columnId: "n", direction: "desc" },
				],
				filters: [
					{ id: "x", columnId: "s", op: "is", value: "missing-option" },
					{ id: "y", columnId: "n", op: "contains", value: 1 },
					{ id: "z", columnId: "n", op: "gt", value: "5" },
				],
			}),
			columns,
		);
		expect(view.sorts).toEqual([{ columnId: "n", direction: "asc" }]);
		expect(view.layout).toBe("table");
		expect(view.filters).toEqual([
			{ id: "x", columnId: "s", op: "is" },
			{ id: "z", columnId: "n", op: "gt", value: 5 },
		]);
		expect(cleanView("junk", columns)).toMatchObject({ sorts: [], filters: [] });
	});
});

describe("prefill", () => {
	it("gives a new row values that match the filters", () => {
		const view = {
			sorts: [],
			filters: [
				f("s", "is", "done"),
				f("m", "contains", "a"),
				f("c", "checked"),
				f(TITLE_COLUMN, "contains", "x"),
				f("n", "gt", 4),
			],
		};
		expect(prefill(columns, view)).toEqual({ title: "x", cells: { s: "done", m: ["a"], c: true } });
	});
});

describe("relation filters and sorts", () => {
	const rel: Column = {
		id: "r",
		name: "Project",
		type: "relation",
		relation: { databaseId: "11111111-1111-4111-8111-111111111111" },
	};
	const cols = [columns[0]!, rel];
	const titles = { p1: "Apollo", p2: "Zephyr" };
	const list = [row("1", "a", { r: ["p2"] }), row("2", "b", { r: ["p1", "p2"] }), row("3", "c")];

	it("matches the linked rows' titles", () => {
		const view = { sorts: [], filters: [f("r", "contains", "apol")] };
		expect(ids(applyView(cols, list, view, new Set(), titles))).toBe("2");
		expect(
			ids(applyView(cols, list, { sorts: [], filters: [f("r", "empty")] }, new Set(), titles)),
		).toBe("3");
	});

	it("sorts by the first linked title, empties last", () => {
		const view = { sorts: [{ columnId: "r", direction: "asc" as const }], filters: [] };
		expect(ids(applyView(cols, list, view, new Set(), titles))).toBe("213");
	});
});

describe("layouts", () => {
	const withDate = columns;
	const noDate = columns.filter((c) => c.type !== "date");

	it("keeps list, gallery and calendar layouts and drops unknown ones", () => {
		for (const layout of ["list", "gallery", "calendar", "board", "table"])
			expect(cleanView({ layout }, withDate).layout).toBe(layout);
		expect(cleanView({ layout: "timeline" }, withDate).layout).toBe("table");
	});

	it("keeps a calendar's date property only while it is a date", () => {
		expect(cleanView({ layout: "calendar", dateBy: "d" }, withDate).dateBy).toBe("d");
		expect(cleanView({ layout: "calendar", dateBy: "n" }, withDate).dateBy).toBeUndefined();
		expect(cleanView({ layout: "list", dateBy: "d" }, withDate).dateBy).toBeUndefined();
	});

	it("names new views by layout and points a calendar at the first date", () => {
		const calendar = newView([], "calendar", withDate);
		expect(calendar).toMatchObject({ name: "Calendar", layout: "calendar", dateBy: "d" });
		expect(newView([calendar], "calendar", withDate).name).toBe("Calendar 2");
		expect(newView([], "gallery", withDate)).toMatchObject({ name: "Gallery", layout: "gallery" });
		expect(newView([], "calendar", noDate).dateBy).toBeUndefined();
	});
});
