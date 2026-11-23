/**
 * A database's views: a table, board, list, gallery or calendar, each with its
 * own sorts and filters (a board also has the select property it groups by, a
 * calendar the date property it places rows on). Pure functions shared
 * by the server (which stores and cleans views) and the browser (which applies
 * them). Filters all have to match (AND), like Notion's simple filters.
 */
import {
	cleanName,
	dayKey,
	type FileRef,
	readCell,
	shortId,
	type Column,
	type ColumnType,
	type Row,
	type SelectOption,
} from "./columns.ts";
import { rollupKind } from "./rollup.ts";
import { isScriptError } from "./script/script.ts";

export const MAX_SORTS = 10;
export const MAX_FILTERS = 20;
const MAX_FILTER_TEXT = 200;

export type Direction = "asc" | "desc";

export interface Sort {
	columnId: string;
	direction: Direction;
}

export interface Filter {
	id: string;
	columnId: string;
	op: string;
	/** Text, a number, an option id or a `YYYY-MM-DD` date, depending on the column. */
	value?: string | number;
}

export const LAYOUTS = ["table", "board", "list", "gallery", "calendar"] as const;
export type Layout = (typeof LAYOUTS)[number];

export interface View {
	id: string;
	name: string;
	layout: Layout;
	sorts: Sort[];
	filters: Filter[];
	/** Board only: the select column whose options are the board's groups. */
	groupBy?: string;
	/** Calendar only: the date column that places rows on days. */
	dateBy?: string;
}

export const MAX_VIEWS = 20;
export const LAYOUT_NAMES: Record<Layout, string> = {
	table: "Table",
	board: "Board",
	list: "List",
	gallery: "Gallery",
	calendar: "Calendar",
};

export function isLayout(value: unknown): value is Layout {
	return typeof value === "string" && (LAYOUTS as readonly string[]).includes(value);
}

/** The sorts and filters part of a view (all that sorting and filtering needs). */
export type ViewQuery = Pick<View, "sorts" | "filters">;

export interface FilterOp {
	op: string;
	label: string;
	/** Whether the filter needs a value; without one it matches every row. */
	needsValue: boolean;
}

const op = (name: string, label: string, needsValue = true): FilterOp => ({
	op: name,
	label,
	needsValue,
});
const EMPTY = [op("empty", "is empty", false), op("not_empty", "is not empty", false)];
const TEXT_OPS = [
	op("contains", "contains"),
	op("not_contains", "does not contain"),
	op("is", "is"),
	op("is_not", "is not"),
	op("starts_with", "starts with"),
	op("ends_with", "ends with"),
	...EMPTY,
];

const DATE_OPS = [
	op("is", "is"),
	op("before", "is before"),
	op("after", "is after"),
	op("on_or_before", "is on or before"),
	op("on_or_after", "is on or after"),
	...EMPTY,
];
// The value is an email.
const PERSON_OPS = [op("contains", "contains"), op("not_contains", "does not contain"), ...EMPTY];
const SELECT_OPS = [op("is", "is"), op("is_not", "is not"), ...EMPTY];

/** The filter operators each column type offers; the first is the default. */
export const FILTER_OPS: Record<ColumnType, FilterOp[]> = {
	title: TEXT_OPS,
	text: TEXT_OPS,
	url: TEXT_OPS,
	email: TEXT_OPS,
	phone: TEXT_OPS,
	status: SELECT_OPS,
	person: PERSON_OPS,
	// Matched against the files' names.
	files: TEXT_OPS,
	created_time: DATE_OPS,
	last_edited_time: DATE_OPS,
	created_by: PERSON_OPS,
	last_edited_by: PERSON_OPS,
	number: [
		op("eq", "="),
		op("neq", "≠"),
		op("gt", ">"),
		op("lt", "<"),
		op("gte", "≥"),
		op("lte", "≤"),
		...EMPTY,
	],
	select: SELECT_OPS,
	multi_select: [op("contains", "contains"), op("not_contains", "does not contain"), ...EMPTY],
	date: DATE_OPS,
	checkbox: [op("checked", "is checked", false), op("unchecked", "is not checked", false)],
	// Matched against the titles of the linked rows.
	relation: [op("contains", "contains"), op("not_contains", "does not contain"), ...EMPTY],
	// Rollups filter like their result (see `filterType`).
	rollup: TEXT_OPS,
	script: TEXT_OPS,
};

/**
 * The type a column filters and sorts as. A rollup acts like its result: a
 * number, a date, or text (a list of values, joined).
 */
export function filterType(column: Column): ColumnType {
	if (column.type === "script") return column.script?.kind ?? "text";
	if (column.type === "created_time" || column.type === "last_edited_time") return "date";
	if (column.type === "created_by" || column.type === "last_edited_by") return "person";
	if (column.type !== "rollup") return column.type;
	const kind = rollupKind(column);
	return kind === "date" ? "date" : kind === "list" ? "text" : "number";
}

/** The filter operators offered for `column`; the first is the default. */
export const opsFor = (column: Column): FilterOp[] => FILTER_OPS[filterType(column)];

/** Whether `column` matches and sorts as another type (see `asPlain`). */
const actsAsOther = (column: Column) =>
	column.type === "rollup" ||
	column.type === "script" ||
	column.type === "created_time" ||
	column.type === "last_edited_time" ||
	column.type === "created_by" ||
	column.type === "last_edited_by";

/**
 * A rollup, script or automatic property as a plain column and row of the type
 * it acts like, for matching and sorting. Times match by their (local) day.
 */
function asPlain(column: Column, row: Row): { column: Column; row: Row } {
	const read = readCell(column, row.cells[column.id]);
	const value = isScriptError(read) ? null : read;
	const type = filterType(column);
	const plain =
		typeof value === "number" && type === "date"
			? dayKey(new Date(value))
			: Array.isArray(value) && type !== "person"
				? value.join(", ")
				: value;
	return {
		column: { id: column.id, name: column.name, type },
		row: { ...row, cells: { [column.id]: plain } },
	};
}

/** Whether a board can group by `column`: by its options. */
export const canGroup = (column: Column | undefined) =>
	column?.type === "select" || column?.type === "status";

export const emptyView = (): View => ({
	id: "table",
	name: "Table",
	layout: "table",
	sorts: [],
	filters: [],
});

/**
 * A new view, named so it doesn't clash with `views`. Boards group by the
 * first select, calendars use the first date.
 */
export function newView(views: View[], layout: Layout, columns: Column[]): View {
	const base = LAYOUT_NAMES[layout];
	const taken = new Set(views.map((v) => v.name.toLowerCase()));
	let name = base;
	for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
	const view: View = { id: shortId(), name, layout, sorts: [], filters: [] };
	const select = columns.find((c) => canGroup(c));
	if (layout === "board" && select) view.groupBy = select.id;
	const date = columns.find((c) => c.type === "date");
	if (layout === "calendar" && date) view.dateBy = date.id;
	return view;
}

/** Stored views (or a view saved before there were several), always at least one. */
export function cleanViews(raw: unknown, columns: Column[]): View[] {
	let input = raw;
	if (typeof input === "string") {
		try {
			input = JSON.parse(input);
		} catch {
			input = null;
		}
	}
	const list =
		input && typeof input === "object" && Array.isArray((input as { views?: unknown }).views)
			? ((input as { views: unknown[] }).views as unknown[])
			: input && typeof input === "object"
				? [{ ...(input as object), id: "table", name: "Table", layout: "table" }]
				: [];
	const views: View[] = [];
	for (const item of list) {
		if (views.length >= MAX_VIEWS) break;
		const view = cleanView(item, columns);
		if (views.some((v) => v.id === view.id)) view.id = shortId();
		views.push(view);
	}
	return views.length > 0 ? views : [emptyView()];
}

export function findOp(column: Column, name: string): FilterOp | undefined {
	return opsFor(column).find((o) => o.op === name);
}

/** A new filter on `column` with its default operator. */
export function newFilter(column: Column): Filter {
	return { id: shortId(), columnId: column.id, op: opsFor(column)[0]!.op };
}

function cleanValue(column: Column, value: unknown): string | number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	switch (filterType(column)) {
		case "number": {
			const n = typeof value === "number" ? value : Number(value);
			return typeof value !== "boolean" && Number.isFinite(n) ? n : undefined;
		}
		case "date":
			return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
		case "select":
		case "status":
		case "multi_select":
			return typeof value === "string" && column.options?.some((o) => o.id === value)
				? value
				: undefined;
		case "person":
			return typeof value === "string"
				? value
						.trim()
						.replace(/[A-Z]/g, (c) => c.toLowerCase())
						.slice(0, 320)
				: undefined;
		default:
			return typeof value === "string" ? value.slice(0, MAX_FILTER_TEXT) : undefined;
	}
}

/**
 * A view from storage or from the browser, keeping only sorts and filters that
 * still make sense for `columns` (a deleted column or a changed type drops them).
 */
export function cleanView(raw: unknown, columns: Column[]): View {
	let input = raw;
	if (typeof input === "string") {
		try {
			input = JSON.parse(input);
		} catch {
			input = null;
		}
	}
	const view = emptyView();
	if (!input || typeof input !== "object") return view;
	const { sorts, filters, id, name, layout, groupBy, dateBy } = input as Record<string, unknown>;
	const byId = new Map(columns.map((c) => [c.id, c]));
	if (typeof id === "string" && /^[\w-]{1,20}$/.test(id)) view.id = id;
	if (isLayout(layout)) view.layout = layout;
	view.name = cleanName(name, 60) ?? LAYOUT_NAMES[view.layout];
	if (view.layout === "board" && typeof groupBy === "string" && canGroup(byId.get(groupBy))) {
		view.groupBy = groupBy;
	}
	if (view.layout === "calendar" && typeof dateBy === "string" && byId.get(dateBy)?.type === "date")
		view.dateBy = dateBy;

	for (const item of Array.isArray(sorts) ? sorts : []) {
		if (!item || typeof item !== "object" || view.sorts.length >= MAX_SORTS) continue;
		const { columnId, direction } = item as Record<string, unknown>;
		if (typeof columnId !== "string" || !byId.has(columnId)) continue;
		if (view.sorts.some((s) => s.columnId === columnId)) continue;
		view.sorts.push({ columnId, direction: direction === "desc" ? "desc" : "asc" });
	}

	const ids = new Set<string>();
	for (const item of Array.isArray(filters) ? filters : []) {
		if (!item || typeof item !== "object" || view.filters.length >= MAX_FILTERS) continue;
		const { id: rawId, columnId, op: opName, value } = item as Record<string, unknown>;
		const column = typeof columnId === "string" ? byId.get(columnId) : undefined;
		if (!column || typeof opName !== "string" || !findOp(column, opName)) continue;
		const filterId =
			typeof rawId === "string" && rawId && !ids.has(rawId) ? rawId.slice(0, 20) : shortId();
		ids.add(filterId);
		const filter: Filter = { id: filterId, columnId: column.id, op: opName };
		const clean = cleanValue(column, value);
		if (clean !== undefined) filter.value = clean;
		view.filters.push(filter);
	}
	return view;
}

/** Whether a filter can't narrow anything yet (it needs a value it doesn't have). */
export function isIdle(column: Column, filter: Filter): boolean {
	return Boolean(findOp(column, filter.op)?.needsValue) && filter.value === undefined;
}

function text(column: Column, row: Row): string {
	if (column.type === "title") return row.title;
	const value = readCell(column, row.cells[column.id]);
	if (column.type === "files") return (value as FileRef[]).map((f) => f.name).join(", ");
	return typeof value === "string" ? value : "";
}

/** Titles of related rows, by id (`DatabaseState.titles`). */
export type Titles = Record<string, string>;

const related = (column: Column, row: Row, titles: Titles) =>
	(readCell(column, row.cells[column.id]) as string[]).map(
		(id) => (titles[id] ?? "").trim() || "Untitled",
	);

export function matches(column: Column, row: Row, filter: Filter, titles: Titles = {}): boolean {
	if (isIdle(column, filter)) return true;
	if (actsAsOther(column)) {
		const plain = asPlain(column, row);
		return matches(plain.column, plain.row, filter, titles);
	}
	const v = filter.value;
	switch (column.type) {
		case "title":
		case "text":
		case "url":
		case "email":
		case "phone":
		case "files": {
			const s = text(column, row).trim().toLowerCase();
			const q = String(v ?? "").toLowerCase();
			switch (filter.op) {
				case "contains":
					return s.includes(q);
				case "not_contains":
					return !s.includes(q);
				case "is":
					return s === q.trim();
				case "is_not":
					return s !== q.trim();
				case "starts_with":
					return s.startsWith(q);
				case "ends_with":
					return s.endsWith(q);
				case "empty":
					return s === "";
				case "not_empty":
					return s !== "";
			}
			return true;
		}
		case "number": {
			const n = readCell(column, row.cells[column.id]) as number | null;
			if (filter.op === "empty") return n === null;
			if (filter.op === "not_empty") return n !== null;
			if (filter.op === "neq") return n !== v;
			if (n === null || typeof v !== "number") return false;
			return filter.op === "eq"
				? n === v
				: filter.op === "gt"
					? n > v
					: filter.op === "lt"
						? n < v
						: filter.op === "gte"
							? n >= v
							: n <= v;
		}
		case "person": {
			const emails = (readCell(column, row.cells[column.id]) as string[] | null) ?? [];
			if (filter.op === "empty") return emails.length === 0;
			if (filter.op === "not_empty") return emails.length > 0;
			const has = emails.includes(String(v ?? ""));
			return filter.op === "contains" ? has : !has;
		}
		case "select":
		case "status": {
			const option = readCell(column, row.cells[column.id]) as SelectOption | null;
			if (filter.op === "empty") return option === null;
			if (filter.op === "not_empty") return option !== null;
			return filter.op === "is" ? option?.id === v : option?.id !== v;
		}
		case "multi_select": {
			const options = readCell(column, row.cells[column.id]) as SelectOption[];
			if (filter.op === "empty") return options.length === 0;
			if (filter.op === "not_empty") return options.length > 0;
			const has = options.some((o) => o.id === v);
			return filter.op === "contains" ? has : !has;
		}
		case "date": {
			const d = readCell(column, row.cells[column.id]) as string | null;
			if (filter.op === "empty") return d === null;
			if (filter.op === "not_empty") return d !== null;
			if (d === null || typeof v !== "string") return false;
			return filter.op === "is"
				? d === v
				: filter.op === "before"
					? d < v
					: filter.op === "after"
						? d > v
						: filter.op === "on_or_before"
							? d <= v
							: d >= v;
		}
		case "checkbox": {
			const on = readCell(column, row.cells[column.id]) === true;
			return filter.op === "checked" ? on : !on;
		}
		case "relation": {
			const names = related(column, row, titles);
			if (filter.op === "empty") return names.length === 0;
			if (filter.op === "not_empty") return names.length > 0;
			const q = String(v ?? "").toLowerCase();
			const has = names.some((name) => name.toLowerCase().includes(q));
			return filter.op === "contains" ? has : !has;
		}
	}
	return true;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A comparable key for sorting, or `null` for an empty cell (empties always sort last). */
function sortKey(column: Column, row: Row, titles: Titles): string | number | null {
	// Times sort to the millisecond, not by day.
	if (column.type === "created_time" || column.type === "last_edited_time")
		return readCell(column, row.cells[column.id]) as number | null;
	if (actsAsOther(column)) {
		const plain = asPlain(column, row);
		return sortKey(plain.column, plain.row, titles);
	}
	switch (column.type) {
		case "title":
		case "text":
		case "url":
		case "email":
		case "phone":
		case "files": {
			const s = text(column, row).trim();
			return s || null;
		}
		case "person":
			return ((readCell(column, row.cells[column.id]) as string[] | null) ?? [])[0] ?? null;
		case "number":
			return readCell(column, row.cells[column.id]) as number | null;
		case "date":
			return readCell(column, row.cells[column.id]) as string | null;
		case "checkbox":
			return readCell(column, row.cells[column.id]) === true ? 1 : 0;
		case "relation":
			return related(column, row, titles)[0] ?? null;
		case "select":
		case "status":
		case "multi_select": {
			// By the options' own order, like Notion.
			const value = readCell(column, row.cells[column.id]);
			const first = Array.isArray(value) ? value[0] : value;
			const index =
				column.options?.findIndex((o) => o.id === (first as SelectOption | null)?.id) ?? -1;
			return index < 0 ? null : index;
		}
	}
	return null;
}

/** The rows to show: filtered, then sorted (stable, so ties keep their stored order). */
export function applyView(
	columns: Column[],
	rows: Row[],
	view: ViewQuery,
	keep: ReadonlySet<string> = new Set(),
	titles: Titles = {},
): Row[] {
	const byId = new Map(columns.map((c) => [c.id, c]));
	const filters = view.filters.flatMap((f) => {
		const column = byId.get(f.columnId);
		return column ? [{ column, filter: f }] : [];
	});
	const shown = rows.filter(
		(row) =>
			keep.has(row.id) ||
			filters.every(({ column, filter }) => matches(column, row, filter, titles)),
	);
	const sorts = view.sorts.flatMap((s) => {
		const column = byId.get(s.columnId);
		return column ? [{ column, sign: s.direction === "desc" ? -1 : 1 }] : [];
	});
	if (sorts.length === 0) return shown;
	return shown
		.map((row, index) => ({
			row,
			index,
			keys: sorts.map(({ column }) => sortKey(column, row, titles)),
		}))
		.sort((a, b) => {
			for (let i = 0; i < sorts.length; i++) {
				const x = a.keys[i] ?? null;
				const y = b.keys[i] ?? null;
				if (x === y) continue;
				if (x === null) return 1;
				if (y === null) return -1;
				const order =
					typeof x === "number" && typeof y === "number"
						? x - y
						: collator.compare(String(x), String(y));
				if (order !== 0) return order * sorts[i]!.sign;
			}
			return a.index - b.index;
		})
		.map((item) => item.row);
}

/**
 * Values for a row added while filters are on, so it matches them where a single
 * value can (an `is` or `contains` filter). Returns the title and the cells.
 */
export function prefill(
	columns: Column[],
	view: ViewQuery,
): { title?: string; cells: Record<string, unknown> } {
	const out: { title?: string; cells: Record<string, unknown> } = { cells: {} };
	for (const filter of view.filters) {
		const column = columns.find((c) => c.id === filter.columnId);
		if (!column) continue;
		const v = filter.value;
		if (column.type === "checkbox") {
			if (filter.op === "checked") out.cells[column.id] = true;
		} else if (v === undefined) {
			continue;
		} else if (column.type === "title") {
			if (filter.op === "is" || filter.op === "contains" || filter.op === "starts_with")
				out.title = String(v);
		} else if (column.type === "multi_select" || column.type === "person") {
			if (filter.op === "contains") {
				const list = (out.cells[column.id] as string[] | undefined) ?? [];
				out.cells[column.id] = [...list, v];
			}
		} else if (
			["is", "contains", "starts_with", "eq", "on_or_before", "on_or_after"].includes(filter.op)
		) {
			out.cells[column.id] = v;
		}
	}
	return out;
}
