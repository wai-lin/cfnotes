/**
 * Rollups: a column that looks through one of the database's relations at a
 * property of the related rows and calculates something (show them, count,
 * sum, earliest date, …). Computed by the server when it loads a database.
 */
import {
	dayKey,
	readCell,
	type Column,
	type ColumnType,
	type FileRef,
	type Row,
	type SelectOption,
} from "./columns.ts";

export interface RollupConfig {
	/** A relation column in the same database. */
	relationId: string;
	/** A column in the related database (`title` for the row names). */
	targetId: string;
	fn: RollupFn;
}

/** What a rollup's result looks like, which decides how it's shown, sorted and filtered. */
export type RollupKind = "list" | "number" | "percent" | "date";

interface FnInfo {
	label: string;
	kind: RollupKind;
	/** Property types it works on; unset means any. */
	types?: ColumnType[];
}

const DATES: ColumnType[] = ["date", "created_time", "last_edited_time"];

export const ROLLUP_FNS = {
	show_original: { label: "Show original", kind: "list" },
	count_all: { label: "Count all", kind: "number" },
	count_values: { label: "Count values", kind: "number" },
	count_unique: { label: "Count unique values", kind: "number" },
	count_empty: { label: "Count empty", kind: "number" },
	count_not_empty: { label: "Count not empty", kind: "number" },
	percent_empty: { label: "Percent empty", kind: "percent" },
	percent_not_empty: { label: "Percent not empty", kind: "percent" },
	sum: { label: "Sum", kind: "number", types: ["number"] },
	average: { label: "Average", kind: "number", types: ["number"] },
	median: { label: "Median", kind: "number", types: ["number"] },
	min: { label: "Min", kind: "number", types: ["number"] },
	max: { label: "Max", kind: "number", types: ["number"] },
	range: { label: "Range", kind: "number", types: ["number"] },
	earliest: { label: "Earliest date", kind: "date", types: DATES },
	latest: { label: "Latest date", kind: "date", types: DATES },
	date_range: { label: "Date range (days)", kind: "number", types: DATES },
	checked: { label: "Checked", kind: "number", types: ["checkbox"] },
	unchecked: { label: "Unchecked", kind: "number", types: ["checkbox"] },
	percent_checked: { label: "Percent checked", kind: "percent", types: ["checkbox"] },
	percent_unchecked: { label: "Percent unchecked", kind: "percent", types: ["checkbox"] },
} satisfies Record<string, FnInfo>;

export type RollupFn = keyof typeof ROLLUP_FNS;

export const isRollupFn = (value: unknown): value is RollupFn =>
	typeof value === "string" && Object.hasOwn(ROLLUP_FNS, value);

/** The calculations offered for a property of `type`. */
export function fnsFor(type: ColumnType): RollupFn[] {
	return (Object.keys(ROLLUP_FNS) as RollupFn[]).filter((fn) => {
		const types = (ROLLUP_FNS[fn] as FnInfo).types;
		return !types || types.includes(type);
	});
}

export const rollupKind = (column: Column): RollupKind =>
	column.rollup ? ROLLUP_FNS[column.rollup.fn].kind : "list";

export function parseRollup(value: unknown): RollupConfig | null {
	if (!value || typeof value !== "object") return null;
	const { relationId, targetId, fn } = value as Record<string, unknown>;
	if (typeof relationId !== "string" || typeof targetId !== "string" || !isRollupFn(fn))
		return null;
	return { relationId, targetId, fn };
}

/** A related row's values in `column`, as strings, numbers or booleans (empty = none). */
function valuesOf(
	column: Column,
	row: Row,
	titles: Record<string, string>,
): (string | number | boolean)[] {
	if (column.type === "title") return row.title.trim() ? [row.title.trim()] : [];
	const value = readCell(column, row.cells[column.id]);
	switch (column.type) {
		case "text":
		case "url":
		case "email":
		case "phone":
		case "date":
			return typeof value === "string" && value ? [value] : [];
		case "created_time":
		case "last_edited_time":
			return typeof value === "number" ? [dayKey(new Date(value))] : [];
		case "person":
		case "created_by":
		case "last_edited_by":
			return value as string[];
		case "files":
			return (value as FileRef[]).map((f) => f.name);
		case "number":
			return typeof value === "number" ? [value] : [];
		case "checkbox":
			return [value === true];
		case "select":
		case "status":
			return value ? [(value as SelectOption).name] : [];
		case "multi_select":
			return (value as SelectOption[]).map((o) => o.name);
		case "relation":
			return (value as string[]).map((id) => (titles[id] ?? "").trim() || "Untitled");
		default:
			return [];
	}
}

const round = (n: number) => Math.round(n * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The rollup of `rows` (the related rows of one row) in `target`. Returns a
 * number, a `YYYY-MM-DD` date, a list of strings, or `null` for empty.
 */
export function computeRollup(
	fn: RollupFn,
	target: Column,
	rows: Row[],
	titles: Record<string, string> = {},
): number | string | string[] | null {
	const perRow = rows.map((row) => valuesOf(target, row, titles));
	// A checkbox always has a value; "empty" means unchecked.
	const isEmpty = (values: (string | number | boolean)[]) =>
		values.length === 0 || (target.type === "checkbox" && values[0] === false);
	const flat = perRow.filter((v) => !isEmpty(v)).flat();
	const numbers = flat.filter((v): v is number => typeof v === "number");
	const dates = flat.filter((v): v is string => typeof v === "string").sort();
	const percent = (count: number) => (rows.length ? round((count / rows.length) * 100) : null);
	const emptyCount = perRow.filter(isEmpty).length;
	const checkedCount = perRow.filter((v) => v[0] === true).length;

	switch (fn) {
		case "show_original":
			return target.type === "checkbox"
				? perRow.map((v) => (v[0] === true ? "Yes" : "No"))
				: flat.map(String);
		case "count_all":
			return rows.length;
		case "count_values":
			return flat.length;
		case "count_unique":
			return new Set(flat.map(String)).size;
		case "count_empty":
			return emptyCount;
		case "count_not_empty":
			return rows.length - emptyCount;
		case "percent_empty":
			return percent(emptyCount);
		case "percent_not_empty":
			return percent(rows.length - emptyCount);
		case "sum":
			return numbers.length ? round(numbers.reduce((a, b) => a + b, 0)) : null;
		case "average":
			return numbers.length ? round(numbers.reduce((a, b) => a + b, 0) / numbers.length) : null;
		case "median": {
			if (!numbers.length) return null;
			const sorted = [...numbers].sort((a, b) => a - b);
			const mid = Math.floor(sorted.length / 2);
			return round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
		}
		case "min":
			return numbers.length ? Math.min(...numbers) : null;
		case "max":
			return numbers.length ? Math.max(...numbers) : null;
		case "range":
			return numbers.length ? round(Math.max(...numbers) - Math.min(...numbers)) : null;
		case "earliest":
			return dates[0] ?? null;
		case "latest":
			return dates.at(-1) ?? null;
		case "date_range":
			return dates.length
				? Math.round((Date.parse(dates.at(-1)!) - Date.parse(dates[0]!)) / DAY)
				: null;
		case "checked":
			return checkedCount;
		case "unchecked":
			return rows.length - checkedCount;
		case "percent_checked":
			return percent(checkedCount);
		case "percent_unchecked":
			return percent(rows.length - checkedCount);
	}
}
