import { describe, expect, it } from "vitest";

import { TITLE_COLUMN, type Column, type Row } from "./columns.ts";
import {
	addDays,
	applyView,
	cleanView,
	daysBetween,
	groupRows,
	matches,
	newView,
	prefill,
	timelineSpan,
	type Filter,
} from "./view.ts";

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

	it("keeps every layout and drops unknown ones", () => {
		for (const layout of ["list", "gallery", "calendar", "timeline", "board", "table"])
			expect(cleanView({ layout }, withDate).layout).toBe(layout);
		expect(cleanView({ layout: "gantt" }, withDate).layout).toBe("table");
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

describe("automatic, person and status properties", () => {
	const created: Column = { id: "ct", name: "Created", type: "created_time" };
	const author: Column = { id: "cb", name: "Author", type: "created_by" };
	const who: Column = { id: "p", name: "Who", type: "person" };
	const status: Column = {
		id: "st",
		name: "Stage",
		type: "status",
		options: [
			{ id: "draft", name: "Draft", color: "gray", group: "todo" },
			{ id: "live", name: "Published", color: "green", group: "complete" },
		],
	};
	const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
	const row = (id: string, cells: Row["cells"]): Row => ({ id, title: id, cells });
	const rows = [
		row("a", { ct: at(2026, 3, 2, 18), cb: "b@x.io", p: ["b@x.io", "c@x.io"], st: "live" }),
		row("b", { ct: at(2026, 3, 2, 9), cb: "a@x.io", st: "draft" }),
		row("c", { ct: at(2026, 4, 1), p: [] }),
	];
	const ids = (list: Row[]) => list.map((r) => r.id);
	const filter = (columnId: string, op: string, value?: string): Filter => ({
		id: "f",
		columnId,
		op,
		value,
	});
	const all = [created, author, who, status];

	it("filters times by their day and sorts them to the millisecond", () => {
		const view = { sorts: [], filters: [filter("ct", "is", "2026-03-02")] };
		expect(ids(applyView(all, rows, view))).toEqual(["a", "b"]);
		const sorted = { sorts: [{ columnId: "ct", direction: "asc" as const }], filters: [] };
		expect(ids(applyView(all, rows, sorted))).toEqual(["b", "a", "c"]);
	});

	it("filters people by email, for Person and Created by alike", () => {
		expect(matches(who, rows[0]!, filter("p", "contains", "c@x.io"))).toBe(true);
		expect(matches(who, rows[2]!, filter("p", "empty"))).toBe(true);
		expect(matches(author, rows[1]!, filter("cb", "contains", "a@x.io"))).toBe(true);
		expect(matches(author, rows[2]!, filter("cb", "not_empty"))).toBe(false);
	});

	it("filters a status by option, and groups a board by it", () => {
		const view = { sorts: [], filters: [filter("st", "is", "live")] };
		expect(ids(applyView(all, rows, view))).toEqual(["a"]);
		expect(newView([], "board", all).groupBy).toBe("st");
		expect(cleanView({ layout: "board", groupBy: "st" }, all).groupBy).toBe("st");
		expect(cleanView({ layout: "board", groupBy: "cb" }, all).groupBy).toBeUndefined();
	});

	it("prefills a person a filter asks for", () => {
		const view = { sorts: [], filters: [filter("p", "contains", "b@x.io")] };
		expect(prefill(all, view).cells).toEqual({ p: ["b@x.io"] });
	});
});

describe("groupRows", () => {
	const row = (id: string, cells: Row["cells"]): Row => ({ id, title: id, cells });
	const keys = (groups: { key: string; rows: Row[] }[]) =>
		groups.map((g) => [g.key, g.rows.map((r) => r.id).join("")]);

	it("gives every option a group, empty ones too, with no value first", () => {
		const rows = [row("a", { s: "done" }), row("b", {}), row("c", { s: "done" })];
		expect(keys(groupRows(col("s"), rows))).toEqual([
			["", "b"],
			["todo", ""],
			["done", "ac"],
		]);
	});

	it("puts a multi-select row in each of its options' groups", () => {
		const rows = [row("a", { m: ["a", "b"] }), row("b", { m: ["b"] })];
		const groups = groupRows(col("m"), rows);
		expect(keys(groups)).toEqual([
			["", ""],
			["a", "a"],
			["b", "ab"],
		]);
		expect(groups[1]!.value).toEqual(["a"]);
	});

	it("groups dates by month, in order, and dates a new row the 1st", () => {
		const rows = [row("a", { d: "2026-05-20" }), row("b", { d: "2026-03-02" }), row("c", {})];
		const groups = groupRows(col("d"), rows);
		expect(keys(groups)).toEqual([
			["", "c"],
			["2026-03", "b"],
			["2026-05", "a"],
		]);
		expect(groups[1]!.value).toBe("2026-03-01");
	});

	it("groups checkboxes as checked, then unchecked", () => {
		const groups = groupRows(col("c"), [row("a", { c: true }), row("b", {})]);
		expect(keys(groups)).toEqual([
			["true", "a"],
			["false", "b"],
		]);
		expect(groups[1]!.value).toBeUndefined();
	});

	it("groups people by email, but a Created by group sets nothing", () => {
		const person: Column = { id: "p", name: "Who", type: "person" };
		const author: Column = { id: "a", name: "By", type: "created_by" };
		const rows = [row("x", { p: ["b@x.io", "a@x.io"], a: "b@x.io" }), row("y", { p: [] })];
		expect(keys(groupRows(person, rows))).toEqual([
			["", "y"],
			["a@x.io", "x"],
			["b@x.io", "x"],
		]);
		expect(groupRows(person, rows)[1]!.value).toEqual(["a@x.io"]);
		expect(groupRows(author, rows).find((g) => g.key === "b@x.io")!.value).toBeUndefined();
	});

	it("keeps grouping and folded groups only where a layout can use them", () => {
		const table = cleanView(
			{ layout: "table", groupBy: "d", collapsed: ["", 3, "2026-03"] },
			columns,
		);
		expect(table.groupBy).toBe("d");
		expect(table.collapsed).toEqual(["", "2026-03"]);
		expect(cleanView({ layout: "board", groupBy: "d" }, columns).groupBy).toBeUndefined();
		expect(cleanView({ layout: "gallery", groupBy: "s" }, columns).groupBy).toBeUndefined();
		expect(cleanView({ layout: "table", groupBy: "n" }, columns).groupBy).toBeUndefined();
	});
});

describe("timeline", () => {
	const start: Column = { id: "s", name: "Start", type: "date" };
	const end: Column = { id: "e", name: "End", type: "date" };
	const row = (cells: Row["cells"]): Row => ({ id: "r", title: "r", cells });

	it("spans from start to end, or one day without a usable end", () => {
		expect(timelineSpan(row({ s: "2026-03-01", e: "2026-03-04" }), start, end)).toEqual({
			start: "2026-03-01",
			end: "2026-03-04",
		});
		expect(timelineSpan(row({ s: "2026-03-05", e: "2026-03-04" }), start, end)?.end).toBe(
			"2026-03-05",
		);
		expect(timelineSpan(row({ s: "2026-03-05" }), start)?.end).toBe("2026-03-05");
		expect(timelineSpan(row({ e: "2026-03-05" }), start, end)).toBeNull();
	});

	it("counts days across months and daylight saving", () => {
		expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
		expect(addDays("2026-03-30", -31)).toBe("2026-02-27");
		expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
		expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
	});

	it("starts a new timeline on the first two dates, and keeps an end only if it differs", () => {
		const cols: Column[] = [{ id: "title", name: "Name", type: "title" }, start, end];
		expect(newView([], "timeline", cols)).toMatchObject({ dateBy: "s", endBy: "e" });
		expect(cleanView({ layout: "timeline", dateBy: "s", endBy: "s" }, cols).endBy).toBeUndefined();
		expect(cleanView({ layout: "calendar", dateBy: "s", endBy: "e" }, cols).endBy).toBeUndefined();
	});
});
