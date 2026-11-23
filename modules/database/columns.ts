/**
 * Database columns and cell values. Pure functions shared by the server (which
 * validates every change) and the browser (which draws the table).
 *
 * A database stores its columns as JSON; each row stores `{columnId: value}`.
 * The row's title is the row page's own title, shown as the `title` column.
 */

import { parseRollup, type RollupConfig } from "./rollup.ts";
import { isScriptError, parseScript, type ScriptConfig } from "./script/script.ts";
import type { View } from "./view.ts";

export const TITLE_COLUMN = "title";
export const MAX_COLUMNS = 50;
export const MAX_COLUMN_NAME = 100;
export const MAX_TEXT = 2000;
export const MAX_OPTIONS = 100;

export const COLUMN_TYPES = [
	"text",
	"number",
	"select",
	"multi_select",
	"status",
	"date",
	"person",
	"files",
	"checkbox",
	"url",
	"email",
	"phone",
	"relation",
	"rollup",
	"script",
	"created_time",
	"created_by",
	"last_edited_time",
	"last_edited_by",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number] | "title";

export const TYPE_LABELS: Record<ColumnType, string> = {
	title: "Title",
	text: "Text",
	number: "Number",
	select: "Select",
	multi_select: "Multi-select",
	status: "Status",
	date: "Date",
	person: "Person",
	files: "Files & media",
	checkbox: "Checkbox",
	url: "URL",
	email: "Email",
	phone: "Phone",
	relation: "Relation",
	rollup: "Rollup",
	script: "Script",
	created_time: "Created time",
	created_by: "Created by",
	last_edited_time: "Last edited time",
	last_edited_by: "Last edited by",
};

/** Properties the app fills in from the row page itself; they can't be edited. */
export const AUTO_TYPES = new Set<ColumnType>([
	"created_time",
	"created_by",
	"last_edited_time",
	"last_edited_by",
]);

/** Properties whose values are worked out, never stored in a row's cells. */
export const isComputed = (type: ColumnType) =>
	type === "relation" || type === "rollup" || type === "script" || AUTO_TYPES.has(type);

/** A status option's group, which says how far along a row is. */
export const STATUS_GROUPS = [
	{ id: "todo", name: "To-do" },
	{ id: "in_progress", name: "In progress" },
	{ id: "complete", name: "Complete" },
] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number]["id"];

const isStatusGroup = (value: unknown): value is StatusGroup =>
	STATUS_GROUPS.some((g) => g.id === value);

export const COLORS = [
	"gray",
	"brown",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
	"red",
] as const;
export type Color = (typeof COLORS)[number];

/** Colours given to new options in turn (gray last, so the first ones stand out). */
const NEW_OPTION_COLORS: Color[] = [
	"blue",
	"green",
	"orange",
	"purple",
	"pink",
	"yellow",
	"red",
	"brown",
	"gray",
];

export interface SelectOption {
	id: string;
	name: string;
	color: Color;
	/** Status only. */
	group?: StatusGroup;
}

/** A file in a Files & media cell: its key in Blob (see `modules/files`) and its name. */
export interface FileRef {
	key: string;
	name: string;
}

export const MAX_FILES = 20;
export const MAX_PEOPLE = 50;
/** The keys `modules/files` makes: images always have their type's extension. */
const FILE_KEY =
	/^(img\/[0-9a-f-]{36}\.(png|jpg|gif|webp)|file\/[0-9a-f-]{36}(\.(png|jpg|gif|webp|pdf))?)$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+$/;

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	/** Select, multi-select and status only. */
	options?: SelectOption[];
	/** Relation only. */
	relation?: Relation;
	/** Rollup only. */
	rollup?: RollupConfig;
	/** Script only: its TypeScript and compiled code (see `modules/script`). */
	script?: ScriptConfig;
	/** Width in the table, in pixels; unset means the default. */
	width?: number;
}

export const MIN_WIDTH = 80;
export const MAX_WIDTH = 1000;

/** The width a column is drawn at. */
export const columnWidth = (column: Column): number =>
	column.width ?? (column.type === "title" ? 260 : 180);

/**
 * A relation column links rows to rows of `databaseId`. Links are stored
 * per owning column (see `row_relations`). A two-way relation is a pair: the
 * owner names its `twinId` in the other database, and the twin names the
 * owner as `sourceColumnId` and reads the same links backwards.
 */
export interface Relation {
	databaseId: string;
	twinId?: string;
	sourceColumnId?: string;
}

const PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_RELATED = 500;

/** The column whose id the links of `column` are stored under. */
export const linkOwner = (column: Column): string => column.relation?.sourceColumnId ?? column.id;

export type Cells = Record<string, unknown>;

export interface Row {
	id: string;
	title: string;
	cells: Cells;
	/**
	 * Cells holding a formula, by column id (see `modules/script`). Their
	 * worked-out values are in `cells`.
	 */
	formulas?: Record<string, ScriptConfig>;
	/** The row page's emoji, shown in lists and galleries. */
	icon?: string | null;
	/** The row page's cover (a preset id or an image path), shown on gallery cards. */
	cover?: string | null;
}

/** When a row page was made and last changed, and by whom (emails; `null` = unknown). */
export interface RowMeta {
	createdAt: number;
	updatedAt: number;
	createdBy: string | null;
	updatedBy: string | null;
}

/** An automatic property's value for a row, as it's put in the row's cells. */
export function autoValue(type: ColumnType, meta: RowMeta): number | string | undefined {
	switch (type) {
		case "created_time":
			return meta.createdAt;
		case "last_edited_time":
			return meta.updatedAt;
		case "created_by":
			return meta.createdBy ?? undefined;
		case "last_edited_by":
			return meta.updatedBy ?? undefined;
		default:
			return undefined;
	}
}

export interface DatabaseState {
	/** Titles of rows that relation cells link to (they may be in other databases). */
	titles: Record<string, string>;
	/** Its views: tables and boards, each with sorts and filters (see `view.ts`). */
	views: View[];
	id: string;
	title: string;
	/** The page an inline database is embedded in; `null` for a full-page database. */
	hostId: string | null;
	columns: Column[];
	rows: Row[];
	/** Who a Person property can name: everyone who may sign in. */
	people: string[];
}

export const shortId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);

const hasOptions = (type: ColumnType) =>
	type === "select" || type === "multi_select" || type === "status";

/** A new Status property's options, one per group, like Notion's. */
export const defaultStatusOptions = (): SelectOption[] => [
	{ id: shortId(), name: "Not started", color: "gray", group: "todo" },
	{ id: shortId(), name: "In progress", color: "blue", group: "in_progress" },
	{ id: shortId(), name: "Done", color: "green", group: "complete" },
];

export function isColumnType(value: unknown): value is Exclude<ColumnType, "title"> {
	return typeof value === "string" && (COLUMN_TYPES as readonly string[]).includes(value);
}

export function cleanName(value: unknown, max = MAX_COLUMN_NAME): string | null {
	if (typeof value !== "string") return null;
	const name = value.replace(/\s+/g, " ").trim().slice(0, max);
	return name || null;
}

/** Columns for a new database: the title and a Tags multi-select, like Notion. */
export function defaultColumns(): Column[] {
	return [
		{ id: TITLE_COLUMN, name: "Name", type: "title" },
		{ id: shortId(), name: "Tags", type: "multi_select", options: [] },
	];
}

/** Reads stored columns, dropping anything malformed. There is always exactly one title column. */
export function parseColumns(json: string | null | undefined): Column[] {
	let raw: unknown;
	try {
		raw = json ? JSON.parse(json) : null;
	} catch {
		raw = null;
	}
	const columns: Column[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(raw) ? raw : []) {
		if (!item || typeof item !== "object") continue;
		const { id, name, type, options, relation, rollup, script, width } = item as Record<
			string,
			unknown
		>;
		if (typeof id !== "string" || !id || seen.has(id)) continue;
		const isTitle = id === TITLE_COLUMN;
		if (!isTitle && !isColumnType(type)) continue;
		const column: Column = {
			id,
			name: cleanName(name) ?? (isTitle ? "Name" : "Column"),
			type: isTitle ? "title" : (type as ColumnType),
		};
		if (hasOptions(column.type)) column.options = parseOptions(options, column.type === "status");
		if (typeof width === "number" && width >= MIN_WIDTH && width <= MAX_WIDTH) {
			column.width = Math.round(width);
		}
		if (column.type === "relation") {
			const parsed = parseRelation(relation);
			if (!parsed) continue;
			column.relation = parsed;
		}
		if (column.type === "rollup") {
			const parsed = parseRollup(rollup);
			if (!parsed) continue;
			column.rollup = parsed;
		}
		if (column.type === "script") {
			const parsed = parseScript(script);
			if (!parsed) continue;
			column.script = parsed;
		}
		seen.add(id);
		columns.push(column);
	}
	if (!seen.has(TITLE_COLUMN)) columns.unshift({ id: TITLE_COLUMN, name: "Name", type: "title" });
	return columns;
}

function parseRelation(value: unknown): Relation | null {
	if (!value || typeof value !== "object") return null;
	const { databaseId, twinId, sourceColumnId } = value as Record<string, unknown>;
	if (typeof databaseId !== "string" || !PAGE_ID.test(databaseId)) return null;
	const relation: Relation = { databaseId };
	if (typeof twinId === "string" && twinId) relation.twinId = twinId;
	if (typeof sourceColumnId === "string" && sourceColumnId)
		relation.sourceColumnId = sourceColumnId;
	return relation;
}

function parseOptions(value: unknown, status = false): SelectOption[] {
	if (!Array.isArray(value)) return [];
	const options: SelectOption[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const { id, name, color, group } = item as Record<string, unknown>;
		const clean = cleanName(name);
		if (typeof id !== "string" || !clean) continue;
		const option: SelectOption = {
			id,
			name: clean,
			color: (COLORS as readonly unknown[]).includes(color) ? (color as Color) : "gray",
		};
		if (status) option.group = isStatusGroup(group) ? group : "todo";
		options.push(option);
	}
	return options;
}

/** Reads a row's stored values. */
export function parseCells(json: string | null | undefined): Cells {
	try {
		const raw: unknown = json ? JSON.parse(json) : {};
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Cells) : {};
	} catch {
		return {};
	}
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string) => ({ ok: false, error }) as const;

/** A name not used by another column: "Text", "Text 2", … */
function freeName(columns: Column[], base: string): string {
	const taken = new Set(columns.map((c) => c.name.toLowerCase()));
	if (!taken.has(base.toLowerCase())) return base;
	for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function addColumn(
	columns: Column[],
	type: unknown,
	name?: unknown,
	relation?: Relation,
	rollup?: RollupConfig,
	script?: ScriptConfig,
): Result<{ columns: Column[]; id: string }> {
	if (!isColumnType(type)) return fail("invalid_type");
	if ((type === "relation") !== Boolean(relation)) return fail("invalid_relation");
	if ((type === "rollup") !== Boolean(rollup)) return fail("invalid_rollup");
	if ((type === "script") !== Boolean(script)) return fail("invalid_script");
	if (columns.length >= MAX_COLUMNS) return fail("too_many_columns");
	const column: Column = {
		id: shortId(),
		name: freeName(columns, cleanName(name) ?? TYPE_LABELS[type]),
		type,
	};
	if (hasOptions(type)) column.options = type === "status" ? defaultStatusOptions() : [];
	if (relation) column.relation = relation;
	if (rollup) column.rollup = rollup;
	if (script) column.script = script;
	return { ok: true, value: { columns: [...columns, column], id: column.id } };
}

function withColumn(
	columns: Column[],
	id: unknown,
	change: (column: Column) => Column | string,
): Result<Column[]> {
	const index = columns.findIndex((c) => c.id === id);
	if (index < 0) return fail("invalid_column");
	const next = change(columns[index]!);
	if (typeof next === "string") return fail(next);
	return { ok: true, value: columns.with(index, next) };
}

export function renameColumn(columns: Column[], id: unknown, name: unknown): Result<Column[]> {
	const clean = cleanName(name);
	if (!clean) return fail("invalid_name");
	return withColumn(columns, id, (c) => ({ ...c, name: clean }));
}

export function setColumnType(columns: Column[], id: unknown, type: unknown): Result<Column[]> {
	if (!isColumnType(type)) return fail("invalid_type");
	return withColumn(columns, id, (c) => {
		if (c.type === "title") return "title_column";
		// A relation needs a target and owns links; it's made and removed, not converted.
		if (c.type === "relation" || type === "relation") return "relation_type";
		// A rollup is computed from its settings; it's made and removed, not converted.
		if (c.type === "rollup" || type === "rollup") return "rollup_type";
		// So is a script.
		if (c.type === "script" || type === "script") return "script_type";
		const next: Column = { id: c.id, name: c.name, type };
		if (type === "status") {
			// Keeps a select's options, each starting in To-do; a new status gets the usual three.
			const kept = (c.options ?? []).map((o) => ({ ...o, group: o.group ?? ("todo" as const) }));
			next.options = kept.length > 0 ? kept : defaultStatusOptions();
		} else if (hasOptions(type)) {
			next.options = (c.options ?? []).map((o) => {
				const { group: _, ...option } = o;
				return option;
			});
		}
		return next;
	});
}

/** Sets a column's width (`null` = back to the default). */
export function resizeColumn(columns: Column[], id: unknown, width: unknown): Result<Column[]> {
	if (width !== null && (typeof width !== "number" || !Number.isFinite(width))) {
		return fail("invalid_width");
	}
	return withColumn(columns, id, (c) => {
		const { width: _, ...rest } = c;
		return width === null
			? rest
			: { ...rest, width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))) };
	});
}

export function removeColumn(columns: Column[], id: unknown): Result<Column[]> {
	if (id === TITLE_COLUMN) return fail("title_column");
	if (!columns.some((c) => c.id === id)) return fail("invalid_column");
	return { ok: true, value: columns.filter((c) => c.id !== id) };
}

/** Moves a column just before `beforeId` (`null` = to the end). */
export function moveColumn(columns: Column[], id: unknown, beforeId: unknown): Result<Column[]> {
	const column = columns.find((c) => c.id === id);
	if (!column || id === beforeId) return fail("invalid_column");
	const rest = columns.filter((c) => c !== column);
	if (beforeId === null) return { ok: true, value: [...rest, column] };
	const index = rest.findIndex((c) => c.id === beforeId);
	if (index < 0) return fail("invalid_before");
	return { ok: true, value: rest.toSpliced(index, 0, column) };
}

/** A local date as `YYYY-MM-DD`. */
export function dayKey(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string): boolean {
	if (!DATE.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Turns a value from the browser into what's stored for `column`. Select values
 * may name an option that doesn't exist yet (`{name}`); it's created, so the
 * column comes back too. `value: undefined` clears the cell.
 */
export function cleanCell(
	column: Column,
	raw: unknown,
): Result<{ value: unknown; column: Column }> {
	const ok = (value: unknown, next = column) =>
		({ ok: true, value: { value, column: next } }) as const;
	if (raw === null || raw === undefined || raw === "") return ok(undefined);
	switch (column.type) {
		case "title":
			return fail("title_column");
		case "rollup":
		case "script":
		case "created_time":
		case "created_by":
		case "last_edited_time":
		case "last_edited_by":
			return fail("computed");
		case "email":
		case "phone": {
			if (typeof raw !== "string") return fail("invalid_value");
			const text = raw.trim().slice(0, column.type === "email" ? 320 : 50);
			return ok(text || undefined);
		}
		case "person": {
			const list = Array.isArray(raw) ? raw : [raw];
			if (
				list.length > MAX_PEOPLE ||
				!list.every((e) => typeof e === "string" && e.length <= 320 && EMAIL.test(e))
			) {
				return fail("invalid_value");
			}
			// A-Z only, as sign-in compares emails (see `modules/auth/access.ts`).
			const fold = (e: string) => e.replace(/[A-Z]/g, (c) => c.toLowerCase());
			const emails = [...new Set((list as string[]).map(fold))];
			return ok(emails.length > 0 ? emails : undefined);
		}
		case "files": {
			if (!Array.isArray(raw) || raw.length > MAX_FILES) return fail("invalid_value");
			const files: FileRef[] = [];
			for (const item of raw) {
				const { key, name } = (item ?? {}) as Record<string, unknown>;
				const clean = cleanName(name, 200);
				if (typeof key !== "string" || !FILE_KEY.test(key) || !clean) return fail("invalid_value");
				if (!files.some((f) => f.key === key)) files.push({ key, name: clean });
			}
			return ok(files.length > 0 ? files : undefined);
		}
		case "relation": {
			if (!Array.isArray(raw)) return fail("invalid_value");
			const ids = [...new Set(raw)];
			if (
				ids.length > MAX_RELATED ||
				!ids.every((id) => typeof id === "string" && PAGE_ID.test(id))
			) {
				return fail("invalid_value");
			}
			return ok(ids);
		}
		case "text":
		case "url":
			return typeof raw === "string"
				? ok(raw.slice(0, MAX_TEXT) || undefined)
				: fail("invalid_value");
		case "number": {
			const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
			return Number.isFinite(n) ? ok(n) : fail("invalid_value");
		}
		case "checkbox":
			return typeof raw === "boolean" ? ok(raw || undefined) : fail("invalid_value");
		case "date":
			return typeof raw === "string" && validDate(raw) ? ok(raw) : fail("invalid_value");
		case "select":
		case "status":
		case "multi_select": {
			const options = [...(column.options ?? [])];
			const pick = (item: unknown): string | null => {
				if (typeof item === "string") return options.some((o) => o.id === item) ? item : null;
				if (!item || typeof item !== "object") return null;
				const name = cleanName((item as { name?: unknown }).name);
				if (!name) return null;
				const found = options.find((o) => o.name.toLowerCase() === name.toLowerCase());
				if (found) return found.id;
				if (options.length >= MAX_OPTIONS) return null;
				const option: SelectOption = {
					id: shortId(),
					name,
					color: NEW_OPTION_COLORS[options.length % NEW_OPTION_COLORS.length]!,
				};
				if (column.type === "status") option.group = "todo";
				options.push(option);
				return option.id;
			};
			const next = () => ({ ...column, options });
			if (column.type !== "multi_select") {
				const id = pick(raw);
				return id ? ok(id, next()) : fail("invalid_value");
			}
			if (!Array.isArray(raw)) return fail("invalid_value");
			const ids: string[] = [];
			for (const item of raw) {
				const id = pick(item);
				if (!id) return fail("invalid_value");
				if (!ids.includes(id)) ids.push(id);
			}
			return ok(ids.length > 0 ? ids : undefined, next());
		}
	}
}

/**
 * A stored value read for display in `column`. Values stay stored as they were
 * when a column changes type; anything that doesn't fit the new type reads as empty.
 */
export function readCell(column: Column, raw: unknown): unknown {
	switch (column.type) {
		case "title":
			return null;
		case "relation":
			return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
		case "rollup":
			// Computed by the server: a number, a date, or a list of strings.
			if (typeof raw === "number" || typeof raw === "string") return raw;
			return Array.isArray(raw) ? raw.map(String) : null;
		case "script":
			// Worked out on load: a number, text, a date, a yes/no, a list, or an error.
			if (isScriptError(raw)) return raw;
			if (typeof raw === "number" || typeof raw === "string" || typeof raw === "boolean")
				return raw;
			return Array.isArray(raw) ? raw.map(String) : null;
		case "text":
		case "url":
		case "email":
		case "phone":
			return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
		case "person":
		case "created_by":
		case "last_edited_by": {
			const list = Array.isArray(raw) ? raw : [raw];
			return list.filter((e): e is string => typeof e === "string" && EMAIL.test(e));
		}
		case "files":
			return Array.isArray(raw)
				? raw.filter(
						(f): f is FileRef =>
							!!f &&
							typeof f === "object" &&
							typeof (f as FileRef).key === "string" &&
							FILE_KEY.test((f as FileRef).key) &&
							typeof (f as FileRef).name === "string",
					)
				: [];
		case "created_time":
		case "last_edited_time":
			return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
		case "number": {
			const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
			return typeof raw !== "boolean" && raw !== "" && Number.isFinite(n) ? n : null;
		}
		case "checkbox":
			return raw === true;
		case "date":
			return typeof raw === "string" && DATE.test(raw) ? raw : null;
		case "select":
		case "status": {
			const id = Array.isArray(raw) ? raw[0] : raw;
			return column.options?.find((o) => o.id === id) ?? null;
		}
		case "multi_select": {
			const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
			return (column.options ?? []).filter((o) => ids.includes(o.id));
		}
	}
}
