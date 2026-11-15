/**
 * Database columns and cell values. Pure functions shared by the server (which
 * validates every change) and the browser (which draws the table).
 *
 * A database stores its columns as JSON; each row stores `{columnId: value}`.
 * The row's title is the row page's own title, shown as the `title` column.
 */

import { isScriptError, parseScript, type ScriptConfig } from "../script/script";
import { parseRollup, type RollupConfig } from "./rollup";
import type { View } from "./view";

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
	"date",
	"checkbox",
	"url",
	"relation",
	"rollup",
	"script",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number] | "title";

export const TYPE_LABELS: Record<ColumnType, string> = {
	title: "Title",
	text: "Text",
	number: "Number",
	select: "Select",
	multi_select: "Multi-select",
	date: "Date",
	checkbox: "Checkbox",
	url: "URL",
	relation: "Relation",
	rollup: "Rollup",
	script: "Script",
};

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
}

export interface Column {
	id: string;
	name: string;
	type: ColumnType;
	/** Select and multi-select only. */
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
}

export const shortId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);

const hasOptions = (type: ColumnType) => type === "select" || type === "multi_select";

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
		if (hasOptions(column.type)) column.options = parseOptions(options);
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

function parseOptions(value: unknown): SelectOption[] {
	if (!Array.isArray(value)) return [];
	const options: SelectOption[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const { id, name, color } = item as Record<string, unknown>;
		const clean = cleanName(name);
		if (typeof id !== "string" || !clean) continue;
		options.push({
			id,
			name: clean,
			color: (COLORS as readonly unknown[]).includes(color) ? (color as Color) : "gray",
		});
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
	if (hasOptions(type)) column.options = [];
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
		if (hasOptions(type)) next.options = c.options ?? [];
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
			return fail("computed");
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
				const option = {
					id: shortId(),
					name,
					color: NEW_OPTION_COLORS[options.length % NEW_OPTION_COLORS.length]!,
				};
				options.push(option);
				return option.id;
			};
			const next = () => ({ ...column, options });
			if (column.type === "select") {
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
			return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : null;
		case "number": {
			const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
			return typeof raw !== "boolean" && raw !== "" && Number.isFinite(n) ? n : null;
		}
		case "checkbox":
			return raw === true;
		case "date":
			return typeof raw === "string" && DATE.test(raw) ? raw : null;
		case "select": {
			const id = Array.isArray(raw) ? raw[0] : raw;
			return column.options?.find((o) => o.id === id) ?? null;
		}
		case "multi_select": {
			const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
			return (column.options ?? []).filter((o) => ids.includes(o.id));
		}
	}
}
