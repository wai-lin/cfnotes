/**
 * Script properties: a database property whose value is worked out by a small
 * TypeScript function, run in a sealed-off QuickJS sandbox (see `run.ts`).
 *
 * The script is the body of a function `(row, rows, db) => value`:
 * - `row`: this row's properties by name (`row.Price`, `row["Due date"]`),
 *   with relation properties as the related rows themselves;
 * - `rows`: every row of the database, in the same shape;
 * - `db.name`, `db.related("Relation property")`: every row of a linked database.
 *
 * Pure: shared by the server (which runs scripts when a database loads) and the
 * browser (which previews them while one is edited).
 */
import {
	readCell,
	type Cells,
	type Column,
	type DatabaseState,
	type Row,
	type SelectOption,
} from "../database/columns";

export const MAX_SOURCE = 20_000;
export const MAX_JS = 60_000;

/** What a script property stores. `js` is `source` compiled; `error` when it didn't compile. */
export interface ScriptConfig {
	source: string;
	js: string;
	error?: string;
	/** What its results look like, worked out on load (never stored). */
	kind?: ScriptKind;
}

/** How a script's results are shown, sorted and filtered. */
export type ScriptKind = "number" | "text" | "date" | "checkbox";

/** A cell whose script failed for that row. */
export interface ScriptError {
	$error: string;
}

export const isScriptError = (value: unknown): value is ScriptError =>
	!!value && typeof value === "object" && typeof (value as ScriptError).$error === "string";

/** A script's result for one row, as stored on the row while the database is loaded. */
export type ScriptValue = number | string | boolean | string[] | ScriptError | null;

export function parseScript(value: unknown): ScriptConfig | null {
	if (!value || typeof value !== "object") return null;
	const { source, js, error } = value as Record<string, unknown>;
	if (typeof source !== "string" || typeof js !== "string") return null;
	const config: ScriptConfig = { source: source.slice(0, MAX_SOURCE), js: js.slice(0, MAX_JS) };
	if (typeof error === "string" && error) config.error = error.slice(0, 500);
	return config;
}

/** What a new script property starts with. */
export function starterScript(columns: Column[]): string {
	const number = columns.find((c) => c.type === "number");
	const title = columns.find((c) => c.type === "title");
	const example = number
		? `return row[${JSON.stringify(number.name)}] * 2;`
		: `return (row[${JSON.stringify(title?.name ?? "Name")}] ?? "").length;`;
	return `// row: this row's properties by name, e.g. row["Price"]
// rows: every row in this database
// db.related("Relation"): every row of a linked database
// [row:column] cells, e.g. [-1:@] (above), [!:Price] (the whole column)
// sum, avg, min, max, count, round
${example}
`;
}

// ---------- cell formulas ----------

/** Column types whose cells can hold a formula instead of a value (typed with a leading `=`). */
const FORMULA_TYPES = new Set<string>(["text", "number"]);
export const canHoldFormula = (column: Column) => FORMULA_TYPES.has(column.type);

/** How a formula is kept in a row's stored cells. */
export interface StoredFormula {
	$formula: ScriptConfig;
}

export const isStoredFormula = (value: unknown): value is StoredFormula =>
	!!value && typeof value === "object" && "$formula" in value;

/**
 * Takes the formulas out of a row's stored cells (they're worked out on load,
 * and their results go where they were). Returns them by column id.
 */
export function takeFormulas(cells: Cells): Record<string, ScriptConfig> | undefined {
	let formulas: Record<string, ScriptConfig> | undefined;
	for (const [id, value] of Object.entries(cells)) {
		if (!isStoredFormula(value)) continue;
		delete cells[id];
		const config = parseScript(value.$formula);
		if (config) (formulas ??= {})[id] = config;
	}
	return formulas;
}

// ---------- the data a script sees ----------

/** A row as a script sees it: `$id` plus each property's value by name. */
export type ScriptRow = Record<string, unknown> & { $id: string };

/** Something to work out: a script column (`row: -1`, every row) or one cell's formula. */
export interface Program {
	row: number;
	col: number;
	js: string;
	error?: string;
}

/**
 * What the sandbox is given: every row's own values by column position
 * (relations as row ids; the sandbox swaps in the rows), and every program.
 */
export interface SheetInput {
	name: string;
	columns: { name: string; rel: boolean }[];
	rows: { id: string; title: string; v: unknown[] }[];
	/** For each relation property, by name: the linked database's rows. */
	relations: Record<string, { name: string; rows: ScriptRow[] }>;
	programs: Program[];
	/** Cells (`"row:col"`, or `"*:col"` for a whole script column) known to fail, with why. */
	failed: Record<string, string>;
}

/** A program to try instead of what's saved (the editors' previews). */
export interface Draft {
	columnId: string;
	/** A formula in this row's cell; without it, the script column's script. */
	rowId?: string;
	config: Pick<ScriptConfig, "js" | "error">;
}

/**
 * One property's value as a script sees it. In a linked database's rows,
 * relations read as the related rows' titles (one level deep, so no loops).
 */
export function scriptValue(column: Column, row: Row, titles: Record<string, string>): unknown {
	if (column.type === "title") return row.title.trim() || null;
	const raw = row.cells[column.id];
	if (column.type === "script" || row.formulas?.[column.id])
		return isScriptError(raw) ? null : (raw ?? null);
	const value = readCell(column, raw);
	switch (column.type) {
		case "select":
			return (value as SelectOption | null)?.name ?? null;
		case "multi_select":
			return (value as SelectOption[]).map((o) => o.name);
		case "relation":
			return (value as string[]).map((id) => (titles[id] ?? "").trim() || "Untitled");
		case "text":
		case "url":
			return (value as string | null) || null;
		default:
			return value ?? null;
	}
}

function toScriptRows(state: DatabaseState): ScriptRow[] {
	return state.rows.map((row) => {
		const out: ScriptRow = { $id: row.id };
		for (const column of state.columns) out[column.name] = scriptValue(column, row, state.titles);
		return out;
	});
}

const programOf = (config: Pick<ScriptConfig, "js" | "error">, row: number, col: number): Program =>
	config.error ? { row, col, js: "", error: config.error } : { row, col, js: config.js };

/**
 * The input for working out `state`'s script columns and formulas. `linked`
 * holds the databases its relations point to (loaded without their own scripts
 * and rollups). `draft` swaps in an unsaved script or formula.
 */
export function sheetInput(
	state: DatabaseState,
	linked: Map<string, DatabaseState | null>,
	draft?: Draft,
): SheetInput {
	const relations: SheetInput["relations"] = {};
	for (const column of state.columns) {
		if (column.type !== "relation" || !column.relation) continue;
		const target =
			column.relation.databaseId === state.id ? state : linked.get(column.relation.databaseId);
		if (!target) continue;
		relations[column.name] = {
			name: target.title.trim() || "Untitled",
			rows: toScriptRows(target),
		};
	}
	const programs: Program[] = [];
	state.columns.forEach((column, col) => {
		if (column.type !== "script") return;
		const config =
			draft && !draft.rowId && draft.columnId === column.id ? draft.config : column.script;
		if (config) programs.push(programOf(config, -1, col));
	});
	const rows = state.rows.map((row, r) => {
		const v = state.columns.map((column, col) => {
			const isDraft = draft?.rowId === row.id && draft.columnId === column.id;
			const formula = isDraft ? draft.config : row.formulas?.[column.id];
			if (formula && canHoldFormula(column)) {
				programs.push(programOf(formula, r, col));
				return null;
			}
			if (column.type === "relation") return readCell(column, row.cells[column.id]);
			if (column.type === "script") return null;
			return scriptValue(column, row, state.titles);
		});
		return { id: row.id, title: row.title.trim(), v };
	});
	return {
		name: state.title.trim() || "Untitled",
		columns: state.columns.map((c) => ({ name: c.name, rel: c.type === "relation" })),
		rows,
		relations,
		programs,
		failed: {},
	};
}

/** The kind of a script's results: number, checkbox or date when every value is one, else text. */
export function resultKind(values: ScriptValue[]): ScriptKind {
	const present = values.filter((v) => v !== null && !isScriptError(v));
	if (present.length === 0) return "text";
	if (present.every((v) => typeof v === "number")) return "number";
	if (present.every((v) => typeof v === "boolean")) return "checkbox";
	if (present.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) return "date";
	return "text";
}

/** How a result reads as text (lists joined, errors and empties as ""). */
export function scriptText(value: unknown): string {
	if (value === null || value === undefined || isScriptError(value)) return "";
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "boolean") return value ? "Yes" : "No";
	return typeof value === "number" || typeof value === "string" ? String(value) : "";
}
