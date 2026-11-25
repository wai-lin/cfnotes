import { describe, expect, it } from "vitest";

import {
	addColumn,
	cleanCell,
	moveColumn,
	parseColumns,
	readCell,
	removeColumn,
	removeOption,
	renameColumn,
	setColumnType,
	TITLE_COLUMN,
	type Column,
	updateOption,
} from "./columns.ts";

const title: Column = { id: TITLE_COLUMN, name: "Name", type: "title" };
const col = (type: Column["type"], extra: Partial<Column> = {}): Column => ({
	id: type,
	name: type,
	type,
	...extra,
});

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
	if (!result.ok) throw new Error(result.error);
	return result.value;
}

describe("parseColumns", () => {
	it("always has one title column and drops junk", () => {
		expect(parseColumns(null)).toEqual([title]);
		expect(parseColumns("not json")).toEqual([title]);
		const cols = parseColumns(
			JSON.stringify([
				{ id: "a", name: " Price ", type: "number" },
				{ id: "a", name: "dupe", type: "text" },
				{ id: "b", name: "x", type: "bogus" },
				{
					id: "c",
					name: "Tags",
					type: "multi_select",
					options: [{ id: "o", name: "Red", color: "nope" }],
				},
			]),
		);
		expect(cols.map((c) => c.id)).toEqual([TITLE_COLUMN, "a", "c"]);
		expect(cols[1]!.name).toBe("Price");
		expect(cols[2]!.options).toEqual([{ id: "o", name: "Red", color: "gray" }]);
	});
});

describe("column changes", () => {
	it("adds with a free name", () => {
		const one = unwrap(addColumn([title], "text"));
		const two = unwrap(addColumn(one.columns, "text"));
		expect(two.columns.map((c) => c.name)).toEqual(["Name", "Text", "Text 2"]);
		expect(addColumn([title], "nope").ok).toBe(false);
	});

	it("renames, retypes and removes, but never the title's type or the title", () => {
		const cols = [title, col("text")];
		expect(unwrap(renameColumn(cols, "text", "  Notes ")).at(1)!.name).toBe("Notes");
		expect(renameColumn(cols, "text", "  ").ok).toBe(false);
		expect(unwrap(setColumnType(cols, "text", "select")).at(1)).toMatchObject({
			type: "select",
			options: [],
		});
		expect(setColumnType(cols, TITLE_COLUMN, "text").ok).toBe(false);
		expect(removeColumn(cols, TITLE_COLUMN).ok).toBe(false);
		expect(unwrap(removeColumn(cols, "text"))).toEqual([title]);
	});

	it("moves before another column or to the end", () => {
		const cols = [title, col("text"), col("number")];
		expect(unwrap(moveColumn(cols, "number", "text")).map((c) => c.id)).toEqual([
			TITLE_COLUMN,
			"number",
			"text",
		]);
		expect(unwrap(moveColumn(cols, TITLE_COLUMN, null)).map((c) => c.id)).toEqual([
			"text",
			"number",
			TITLE_COLUMN,
		]);
		expect(moveColumn(cols, "text", "missing").ok).toBe(false);
	});
});

describe("cleanCell", () => {
	it("validates simple types", () => {
		expect(unwrap(cleanCell(col("number"), "12.5")).value).toBe(12.5);
		expect(cleanCell(col("number"), "abc").ok).toBe(false);
		expect(unwrap(cleanCell(col("number"), "")).value).toBeUndefined();
		expect(unwrap(cleanCell(col("checkbox"), true)).value).toBe(true);
		expect(unwrap(cleanCell(col("checkbox"), false)).value).toBeUndefined();
		expect(unwrap(cleanCell(col("date"), "2026-02-28")).value).toBe("2026-02-28");
		expect(cleanCell(col("date"), "2026-02-30").ok).toBe(false);
		expect(unwrap(cleanCell(col("text"), "x".repeat(3000))).value).toHaveLength(2000);
	});

	it("creates select options by name and reuses them case-insensitively", () => {
		const tags = col("multi_select", { options: [{ id: "r", name: "Red", color: "red" }] });
		const made = unwrap(cleanCell(tags, ["r", { name: "Blue" }, { name: "red" }]));
		expect(made.column.options!.map((o) => o.name)).toEqual(["Red", "Blue"]);
		expect(made.value).toEqual(["r", made.column.options![1]!.id]);
		expect(cleanCell(tags, ["missing"]).ok).toBe(false);
		const one = unwrap(cleanCell(col("select", { options: [] }), { name: "Done" }));
		expect(one.value).toBe(one.column.options![0]!.id);
	});
});

describe("readCell", () => {
	it("reads values that don't fit the column type as empty", () => {
		expect(readCell(col("number"), "7")).toBe(7);
		expect(readCell(col("number"), "x")).toBeNull();
		expect(readCell(col("date"), 5)).toBeNull();
		const sel = col("select", { options: [{ id: "a", name: "A", color: "blue" }] });
		expect(readCell(sel, ["a", "b"])).toMatchObject({ name: "A" });
		const multi = col("multi_select", sel.options ? { options: sel.options } : {});
		expect(readCell(multi, "a")).toHaveLength(1);
	});
});

describe("relations", () => {
	const target = "11111111-1111-4111-8111-111111111111";
	const rel: Column = {
		id: "r",
		name: "Project",
		type: "relation",
		relation: { databaseId: target },
	};

	it("keeps a relation's target and drops relations without one", () => {
		const cols = parseColumns(
			JSON.stringify([
				{
					id: "r",
					name: "Project",
					type: "relation",
					relation: { databaseId: target, twinId: "t" },
				},
				{ id: "bad", name: "Broken", type: "relation", relation: { databaseId: "nope" } },
			]),
		);
		expect(cols.map((c) => c.id)).toEqual([TITLE_COLUMN, "r"]);
		expect(cols[1]!.relation).toEqual({ databaseId: target, twinId: "t" });
	});

	it("needs a target to be added and can't be converted", () => {
		expect(addColumn([title], "relation").ok).toBe(false);
		expect(
			unwrap(addColumn([title], "relation", "P", { databaseId: target })).columns[1]!.relation,
		).toEqual({
			databaseId: target,
		});
		expect(setColumnType([title, rel], "r", "text").ok).toBe(false);
		expect(setColumnType([title, col("text")], "text", "relation").ok).toBe(false);
	});

	it("accepts a list of page ids, once each", () => {
		expect(unwrap(cleanCell(rel, [target, target])).value).toEqual([target]);
		expect(cleanCell(rel, ["x"]).ok).toBe(false);
		expect(readCell(rel, "junk")).toEqual([]);
	});
});

describe("newer property types", () => {
	it("reads an old Status property as a Select, keeping its options", () => {
		const [, select] = parseColumns(
			JSON.stringify([
				{
					id: "s",
					name: "Stage",
					type: "status",
					options: [{ id: "o", name: "Done", color: "green", group: "complete" }],
				},
			]),
		);
		expect(select).toEqual({
			id: "s",
			name: "Stage",
			type: "select",
			options: [{ id: "o", name: "Done", color: "green" }],
		});
	});

	it("renames, recolours and deletes options, which cells name by id", () => {
		const options = [
			{ id: "a", name: "Draft", color: "gray" as const },
			{ id: "b", name: "Live", color: "green" as const },
		];
		const cols = [col("select", { options })];
		const [renamed] = unwrap(updateOption(cols, "select", "a", { name: " Idea ", color: "blue" }));
		expect(renamed!.options![0]).toEqual({ id: "a", name: "Idea", color: "blue" });
		expect(readCell(renamed!, "a")).toMatchObject({ name: "Idea" });
		expect(updateOption(cols, "select", "a", { name: "live" })).toEqual({
			ok: false,
			error: "duplicate_option",
		});
		expect(updateOption(cols, "select", "a", { color: "teal" }).ok).toBe(false);
		expect(updateOption(cols, "select", "zz", { name: "X" }).ok).toBe(false);
		expect(updateOption([col("text")], "text", "a", { name: "X" }).ok).toBe(false);
		const [removed] = unwrap(removeOption(cols, "select", "a"));
		expect(removed!.options!.map((o) => o.id)).toEqual(["b"]);
		expect(readCell(removed!, "a")).toBeNull();
	});

	it("keeps dates & times to the minute, and times of day", () => {
		const when = col("datetime");
		expect(unwrap(cleanCell(when, "2026-11-25T09:30")).value).toBe("2026-11-25T09:30");
		expect(unwrap(cleanCell(when, "2026-11-25T09:30:59.123")).value).toBe("2026-11-25T09:30");
		expect(unwrap(cleanCell(when, "2026-11-25")).value).toBe("2026-11-25T00:00");
		expect(cleanCell(when, "2026-11-25T24:00").ok).toBe(false);
		expect(cleanCell(when, "2026-02-30T10:00").ok).toBe(false);
		// Between date and date & time, a column reads what it can.
		expect(readCell(when, "2026-11-25")).toBe("2026-11-25T00:00");
		expect(readCell(col("date"), "2026-11-25T09:30")).toBe("2026-11-25");
		expect(unwrap(cleanCell(col("date"), "2026-11-25T09:30")).value).toBe("2026-11-25");

		const time = col("time");
		expect(unwrap(cleanCell(time, "07:05")).value).toBe("07:05");
		expect(unwrap(cleanCell(time, "07:05:10")).value).toBe("07:05");
		expect(cleanCell(time, "7:05").ok).toBe(false);
		expect(cleanCell(time, "23:60").ok).toBe(false);
		expect(readCell(time, "nope")).toBeNull();
	});

	it("cleans emails, phones and people", () => {
		expect(unwrap(cleanCell(col("email"), "  a@b.co ")).value).toBe("a@b.co");
		expect(unwrap(cleanCell(col("phone"), "+1 555 0100")).value).toBe("+1 555 0100");
		expect(unwrap(cleanCell(col("person"), ["A@B.co", "a@b.co"])).value).toEqual(["a@b.co"]);
		expect(cleanCell(col("person"), ["not an email"]).ok).toBe(false);
		expect(cleanCell(col("person"), "x@y.z, w@v.u").ok).toBe(false);
	});

	it("reads only well-formed files", () => {
		const good = { key: "img/0b2c5a6e-1111-4222-8333-444455556666.png", name: "a.png" };
		const raw = [good, { key: "elsewhere/x", name: "x" }, { key: good.key }, "junk"];
		expect(readCell(col("files"), raw)).toEqual([good]);
	});

	it("never stores automatic values", () => {
		for (const type of [
			"created_time",
			"created_by",
			"last_edited_time",
			"last_edited_by",
		] as const)
			expect(cleanCell(col(type), "x")).toEqual({ ok: false, error: "computed" });
	});
});
