/**
 * Databases: their state, and the changes the table UI makes. One action takes
 * `{op, databaseId, …}` and answers with the whole database (`{state}`), so
 * the browser just redraws.
 */
import { Clock, Effect, Option, Schema } from "effect";
import type { SqlError } from "effect/sql";
import { BadRequest, NotFound, type AppEnvId } from "spacefn";

import { isId } from "#lib/ids.ts";
import { placeBefore } from "#lib/order.ts";
import { cleanTitle } from "#lib/titles.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Trash from "#modules/trash/trash.ts";
import MainDb from "#space/db/main.ts";

import {
	addColumn,
	AUTO_TYPES,
	autoValue,
	cleanCell,
	cleanName,
	defaultColumns,
	isComputed,
	linkOwner,
	moveColumn,
	parseCells,
	parseColumns,
	removeColumn,
	renameColumn,
	resizeColumn,
	setColumnType,
	TITLE_COLUMN,
	type Column,
	type DatabaseState,
} from "./columns.ts";
import { computeRollup, fnsFor, isRollupFn, type RollupConfig } from "./rollup.ts";
import { columnValues, runSheet } from "./script/run.ts";
import {
	canHoldFormula,
	isStoredFormula,
	MAX_JS,
	MAX_SOURCE,
	resultKind,
	sheetInput,
	starterScript,
	takeFormulas,
	type ScriptConfig,
} from "./script/script.ts";
import {
	canGroup,
	cleanView,
	cleanViews,
	isLayout,
	MAX_VIEWS,
	newView,
	type View,
} from "./view.ts";

/** Rows a new database starts with, so there's somewhere to type. */
const STARTER_ROWS = 3;
const MAX_ROWS = 5000;

/** A whole script or formula travels in a change, so allow more than its source and output. */
export const OP_LIMITS = { maxBytes: 2 * 1024 * 1024 };

const field = Schema.optional(Schema.Unknown);

/**
 * One change from the table UI. The fields are the ones the ops share; what's
 * in them depends on the database's columns, so each op checks its own.
 */
export const Op = Schema.Struct({
	op: Schema.Literals([
		"create",
		"databases",
		"get",
		"delete",
		"rename",
		"addRow",
		"deleteRow",
		"setTitle",
		"setCell",
		"moveRow",
		"setView",
		"addView",
		"renameView",
		"deleteView",
		"addOption",
		"addColumn",
		"deleteColumn",
		"setRollup",
		"setScript",
		"resizeColumn",
		"renameColumn",
		"setColumnType",
		"moveColumn",
	]),
	databaseId: Schema.optional(Schema.String),
	beforeId: field,
	cells: field,
	columnId: field,
	layout: field,
	name: field,
	options: field,
	relation: field,
	rollup: field,
	rowId: field,
	script: field,
	title: field,
	type: field,
	value: field,
	view: field,
	viewId: field,
	width: field,
});

const findDatabase = (id: string) => Effect.map(MainDb.findDatabase({ id }), Option.getOrUndefined);

export const databaseState: (
	id: string,
	options?: { rollups?: boolean; scripts?: boolean },
) => Effect.Effect<DatabaseState | null, SqlError.SqlError, MainDb | AppEnvId> = Effect.fn(
	"Database.state",
)(function* (id, { rollups = true, scripts = rollups } = {}) {
	const found = yield* findDatabase(id);
	if (!found) return null;
	const stored = yield* MainDb.listRows({ databaseId: id });
	const columns = parseColumns(found.columns);
	const autoColumns = columns.filter((c) => AUTO_TYPES.has(c.type));
	const rows = stored.map((row) => {
		const cells = parseCells(row.cells);
		const formulas = takeFormulas(cells);
		// Automatic properties come from the row page itself.
		const meta = {
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			createdBy: row.created_by,
			updatedBy: row.updated_by,
		};
		for (const column of autoColumns) {
			const value = autoValue(column.type, meta);
			if (value === undefined) delete cells[column.id];
			else cells[column.id] = value;
		}
		return {
			id: row.id,
			title: row.title,
			cells,
			...(formulas ? { formulas } : {}),
			icon: row.icon ?? null,
			cover: row.cover ?? null,
		};
	});
	const titles: Record<string, string> = {};

	// Relation cells come from `row_relations`, read from whichever side this column is on.
	const relationColumns = columns.filter((c) => c.type === "relation");
	if (relationColumns.length > 0) {
		const links = yield* MainDb.listRelations({ databaseId: id });
		const byRow = new Map(rows.map((row) => [row.id, row]));
		for (const row of rows) for (const column of relationColumns) delete row.cells[column.id];
		const linked = new Set<string>();
		for (const column of relationColumns) {
			const owner = linkOwner(column);
			const backwards = Boolean(column.relation?.sourceColumnId);
			for (const link of links) {
				if (link.column_id !== owner) continue;
				const row = byRow.get(backwards ? link.to_id : link.from_id);
				if (!row) continue;
				const other = backwards ? link.from_id : link.to_id;
				((row.cells[column.id] as string[] | undefined) ??= []).push(other);
				linked.add(other);
			}
		}
		if (linked.size > 0) {
			for (const page of yield* MainDb.listTitles({ ids: JSON.stringify([...linked]) })) {
				titles[page.id] = page.title;
			}
		}
		// Links to archived rows stay stored (restoring brings them back) but don't show.
		for (const row of rows) {
			for (const column of relationColumns) {
				const ids = row.cells[column.id] as string[] | undefined;
				if (!ids) continue;
				const shown = ids.filter((other) => other in titles);
				if (shown.length > 0) row.cells[column.id] = shown;
				else delete row.cells[column.id];
			}
		}
	}

	const state: DatabaseState = {
		id,
		title: found.title,
		hostId: found.host_id,
		columns,
		views: cleanViews(found.view, columns),
		rows,
		titles,
		people: yield* Sessions.people,
	};
	if (rollups) yield* addRollups(state);
	if (scripts) yield* addScripts(state);
	return state;
});

/**
 * Fills in script cells and formula cells. They're worked out together (so
 * they can read each other) in one sandbox run per load. Linked databases are
 * loaded without their own scripts and rollups, which rules out loops between
 * databases.
 */
const addScripts = Effect.fn("Database.addScripts")(function* (state: DatabaseState) {
	const scriptColumns = state.columns.filter((c) => c.type === "script" && c.script);
	const hasFormulas = state.rows.some((row) =>
		state.columns.some((c) => row.formulas?.[c.id] && canHoldFormula(c)),
	);
	if (scriptColumns.length === 0 && !hasFormulas) return;
	for (const row of state.rows) for (const column of scriptColumns) delete row.cells[column.id];
	const linked = new Map<string, DatabaseState | null>();
	for (const column of state.columns) {
		const targetId = column.type === "relation" ? column.relation?.databaseId : undefined;
		if (targetId && targetId !== state.id && !linked.has(targetId)) {
			linked.set(targetId, yield* databaseState(targetId, { rollups: false, scripts: false }));
		}
	}
	const input = sheetInput(state, linked);
	const engine = yield* Effect.tryPromise(
		// Loaded on first use, so code that never runs a script never loads the engine.
		async () => (await import("./script/engine.ts")).serverEngine(),
	).pipe(
		Effect.tapError((error) => Effect.logError("The script engine failed to load", error.cause)),
		Effect.orElseSucceed(() => null),
	);
	if (!engine) {
		for (const p of input.programs) {
			const rows = p.row < 0 ? state.rows : [state.rows[p.row]!];
			for (const row of rows)
				row.cells[state.columns[p.col]!.id] = { $error: "Scripts are unavailable." };
		}
		return;
	}
	const result = runSheet(engine, input);
	for (const [key, value] of result.cells) {
		const [r, c] = key.split(":").map(Number);
		const row = state.rows[r!];
		const column = state.columns[c!];
		if (!row || !column) continue;
		if (value === null) delete row.cells[column.id];
		else row.cells[column.id] = value;
	}
	state.columns.forEach((column, col) => {
		if (column.type === "script" && column.script) {
			column.script = { ...column.script, kind: resultKind(columnValues(result, input, col)) };
		}
	});
});

/** A script from the editor: its TypeScript, the JavaScript it compiled to, and any compile error. */
function cleanScript(input: unknown): ScriptConfig | null {
	const raw = (input ?? {}) as Record<string, unknown>;
	if (typeof raw.source !== "string" || typeof raw.js !== "string") return null;
	if (raw.source.length > MAX_SOURCE || raw.js.length > MAX_JS) return null;
	const config: ScriptConfig = { source: raw.source, js: raw.js };
	if (typeof raw.error === "string" && raw.error) {
		config.error = raw.error.slice(0, 500);
		config.js = "";
	}
	return config;
}

/** Columns as stored: a script's worked-out `kind` isn't saved. */
const storable = (columns: Column[]): Column[] =>
	columns.map((c) => {
		if (c.type !== "script" || !c.script) return c;
		const { kind: _, ...script } = c.script;
		return { ...c, script };
	});

/**
 * Fills in rollup cells. Related databases are loaded without their own
 * rollups (a rollup can't look at a rollup), which also rules out loops.
 */
const addRollups = Effect.fn("Database.addRollups")(function* (state: DatabaseState) {
	const rollupColumns = state.columns.filter((c) => c.type === "rollup" && c.rollup);
	if (rollupColumns.length === 0) return;
	// Ignore anything stored under a rollup's id (older saves wrote computed values back).
	for (const row of state.rows) for (const column of rollupColumns) delete row.cells[column.id];
	const related = new Map<string, DatabaseState | null>();
	for (const column of rollupColumns) {
		const config = column.rollup!;
		const relation = state.columns.find((c) => c.id === config.relationId && c.type === "relation");
		const targetId = relation?.relation?.databaseId;
		if (!relation || !targetId) continue;
		if (!related.has(targetId)) {
			related.set(
				targetId,
				targetId === state.id ? state : yield* databaseState(targetId, { rollups: false }),
			);
		}
		const target = related.get(targetId);
		const targetColumn = target?.columns.find((c) => c.id === config.targetId);
		if (!target || !targetColumn || targetColumn.type === "rollup") continue;
		const byId = new Map(target.rows.map((row) => [row.id, row]));
		for (const row of state.rows) {
			const linked = ((row.cells[relation.id] as string[] | undefined) ?? []).flatMap(
				(other) => byId.get(other) ?? [],
			);
			const value = computeRollup(config.fn, targetColumn, linked, target.titles);
			const empty = value === null || (Array.isArray(value) && value.length === 0);
			if (!empty) row.cells[column.id] = value;
		}
	}
});

/** A change the table can't make: a 400, with why as a code. */
const bad = (message: string) => new BadRequest({ message });

/** A valid rollup setting for this database (or the reason it isn't). */
const checkRollup = Effect.fn("Database.checkRollup")(function* (
	state: DatabaseState,
	input: unknown,
) {
	const raw = (input ?? {}) as Record<string, unknown>;
	const relation =
		state.columns.find((c) => c.id === raw.relationId && c.type === "relation") ??
		state.columns.find((c) => c.type === "relation");
	const targetId = relation?.relation?.databaseId;
	if (!relation || !targetId) return yield* bad("needs_relation");
	const target = targetId === state.id ? state : yield* databaseState(targetId, { rollups: false });
	if (!target) return yield* bad("invalid_target");
	const targetColumn =
		target.columns.find((c) => c.id === raw.targetId && c.type !== "rollup") ??
		target.columns.find((c) => c.type === "title")!;
	const allowed = fnsFor(targetColumn.type);
	const fn = isRollupFn(raw.fn) && allowed.includes(raw.fn) ? raw.fn : "show_original";
	const config: RollupConfig = { relationId: relation.id, targetId: targetColumn.id, fn };
	return config;
});

/** Changes another database's columns (the twin side of a two-way relation). */
const editColumns = Effect.fn("Database.editColumns")(function* (
	id: string,
	change: (columns: Column[]) => Column[],
) {
	const found = yield* findDatabase(id);
	if (!found) return;
	const columns = change(parseColumns(found.columns));
	yield* MainDb.updateDatabaseColumns({
		id,
		columns: JSON.stringify(columns),
		now: yield* Clock.currentTimeMillis,
	});
});

const withoutTwin = (column: Column): Column => {
	if (!column.relation) return column;
	const { twinId: _, ...relation } = column.relation;
	return { ...column, relation };
};

/** Makes a database (full-page in a folder, or inline in `hostId`) with starter rows. */
export const newDatabase = Effect.fn("Database.create")(function* (options: {
	folderId: string | null;
	hostId: string | null;
	title?: string;
	/** Who makes it: their email, recorded as the creator of it and its rows. */
	by?: string | null;
}) {
	const id = crypto.randomUUID();
	const now = yield* Clock.currentTimeMillis;
	const by = options.by ?? null;
	yield* MainDb.createDatabase({
		id,
		folderId: options.folderId,
		hostId: options.hostId,
		title: options.title ?? "",
		columns: JSON.stringify(defaultColumns()),
		now,
		by,
	});
	for (let i = 0; i < STARTER_ROWS; i++) {
		yield* MainDb.createRow({
			id: crypto.randomUUID(),
			databaseId: id,
			title: "",
			now: now + i,
			by,
		});
	}
	return id;
});

/** Runs one table change. `pageId` is the page the request came from (it hosts new inline databases). */
export const runOp = Effect.fn("Database.runOp")(function* (pageId: string, body: typeof Op.Type) {
	const now = yield* Clock.currentTimeMillis;
	const by = yield* Sessions.editor;

	if (body.op === "create") {
		const host = Option.getOrUndefined(yield* MainDb.findPage({ id: pageId }));
		if (!host || host.kind === "database") return yield* bad("invalid_host");
		const id = yield* newDatabase({ folderId: null, hostId: pageId, by });
		return { state: yield* databaseState(id) };
	}

	if (body.op === "databases") {
		// For choosing a relation's target.
		const all = yield* MainDb.listDatabases();
		return {
			databases: all.map((d) => ({ id: d.id, title: d.title, hostId: d.host_id })),
		};
	}

	const { databaseId } = body;
	const state = isId(databaseId) ? yield* databaseState(databaseId) : null;
	if (!databaseId || !state) return yield* new NotFound({ message: "No such database" });

	const saveViews = (views: View[]) =>
		MainDb.updateDatabaseView({ id: databaseId, view: JSON.stringify({ views }), now });
	const saveColumns = (columns: Column[]) =>
		MainDb.updateDatabaseColumns({
			id: databaseId,
			columns: JSON.stringify(storable(columns)),
			now,
		});
	const row =
		typeof body.rowId === "string" ? state.rows.find((r) => r.id === body.rowId) : undefined;
	/** Whether a Person value names only people who may sign in. */
	const onlyPeople = (value: unknown) =>
		value === undefined || (value as string[]).every((email) => state.people.includes(email));
	const reply = (extra: Record<string, unknown> = {}) =>
		Effect.map(databaseState(databaseId), (next) => ({ state: next, ...extra }));

	/** Stores one cell (creating a select option if the value names a new one). */
	const writeCell = Effect.fnUntraced(function* (
		row: DatabaseState["rows"][number],
		column: Column,
		value: unknown,
	) {
		const cells = { ...row.cells };
		if (isStoredFormula(value)) {
			// A formula (`{$formula: {source, js, error?}}`), compiled by the browser.
			if (!canHoldFormula(column)) return yield* bad("invalid_value");
			const config = cleanScript(value.$formula);
			if (!config) return yield* bad("invalid_script");
			cells[column.id] = { $formula: config };
		} else {
			const result = cleanCell(column, value);
			if (!result.ok) return yield* bad(result.error);
			if (column.type === "person" && !onlyPeople(result.value.value))
				return yield* bad("invalid_person");
			if (result.value.column !== column) {
				yield* saveColumns(
					state.columns.map((c) => (c.id === column.id ? result.value.column : c)),
				);
			}
			if (result.value.value === undefined) delete cells[column.id];
			else cells[column.id] = result.value.value;
		}
		// The row's other formulas go back where their worked-out values were.
		for (const [id, config] of Object.entries(row.formulas ?? {})) {
			if (id !== column.id) cells[id] = { $formula: config };
		}
		// Relation, rollup, script and automatic values are worked out on load, never stored.
		for (const c of state.columns) if (isComputed(c.type)) delete cells[c.id];
		yield* MainDb.updateRowCells({ id: row.id, cells: JSON.stringify(cells), now, by });
	});

	/** Replaces the rows a relation cell links to. */
	const setRelation = Effect.fnUntraced(function* (column: Column, rowId: string, value: unknown) {
		const relation = column.relation;
		if (!relation) return yield* bad("invalid_column");
		const result = cleanCell(column, value ?? []);
		if (!result.ok) return yield* bad(result.error);
		const ids = (result.value.value as string[] | undefined) ?? [];
		const allowed = new Set(
			(yield* MainDb.listRows({ databaseId: relation.databaseId })).map((r) => r.id),
		);
		const keep = ids.filter((id) => allowed.has(id));
		const owner = linkOwner(column);
		const backwards = Boolean(relation.sourceColumnId);
		if (backwards) yield* MainDb.clearRelationsTo({ columnId: owner, toId: rowId });
		else yield* MainDb.clearRelationsFrom({ columnId: owner, fromId: rowId });
		if (keep.length > 0) {
			const pairs = keep.map((id) => (backwards ? [id, rowId] : [rowId, id]));
			yield* MainDb.addRelations({ columnId: owner, pairs: JSON.stringify(pairs) });
		}
		return yield* reply({ touched: [relation.databaseId] });
	});

	/** `{relation: {databaseId, twoWay}}`: a relation column, and its other side when two-way. */
	const addRelationColumn = Effect.fnUntraced(function* (input: typeof Op.Type) {
		const here = state;
		const config = (input.relation ?? {}) as { databaseId?: unknown; twoWay?: unknown };
		const targetId =
			typeof config.databaseId === "string" && isId(config.databaseId) ? config.databaseId : null;
		const same = targetId === here.id;
		const target = targetId && !same ? yield* findDatabase(targetId) : null;
		if (!targetId || (!same && !target)) return yield* bad("invalid_target");
		const targetTitle = (same ? here.title : target!.title).trim() || "Untitled";

		const made = addColumn(here.columns, "relation", input.name ?? targetTitle, {
			databaseId: targetId,
		});
		if (!made.ok) return yield* bad(made.error);
		let columns = made.value.columns;
		const ownerId = made.value.id;
		const setTwin = (twinId: string) =>
			columns.map((c) =>
				c.id === ownerId && c.relation ? { ...c, relation: { ...c.relation, twinId } } : c,
			);

		if (config.twoWay === true) {
			const ownerName = columns.find((c) => c.id === ownerId)!.name;
			const back = { databaseId: here.id, sourceColumnId: ownerId };
			if (same) {
				const twin = addColumn(columns, "relation", `Related to ${ownerName}`, back);
				if (twin.ok) {
					columns = twin.value.columns;
					columns = setTwin(twin.value.id);
				}
			} else {
				const twin = addColumn(
					parseColumns(target!.columns),
					"relation",
					here.title.trim() || "Untitled",
					back,
				);
				if (twin.ok) {
					yield* MainDb.updateDatabaseColumns({
						id: targetId,
						columns: JSON.stringify(twin.value.columns),
						now,
					});
					columns = setTwin(twin.value.id);
				}
			}
		}
		yield* saveColumns(columns);
		return yield* reply({ columnId: ownerId, touched: [targetId] });
	});

	switch (body.op) {
		case "get":
			return { state };

		case "delete":
			yield* Trash.remove(databaseId);
			return { state: null };

		case "rename":
			yield* MainDb.updatePageTitle({ id: databaseId, title: cleanTitle(body.title), now, by });
			return yield* reply();

		case "addRow": {
			if (state.rows.length >= MAX_ROWS) return yield* bad("too_many_rows");
			const id = crypto.randomUUID();
			yield* MainDb.createRow({ id, databaseId, title: cleanTitle(body.title), now, by });
			// Values that make the row match the current filters (bad ones are skipped).
			if (body.cells && typeof body.cells === "object") {
				let columns = state.columns;
				const cells: Record<string, unknown> = {};
				for (const [columnId, value] of Object.entries(body.cells)) {
					const column = columns.find((c) => c.id === columnId);
					if (!column || column.id === TITLE_COLUMN) continue;
					const result = cleanCell(column, value);
					if (!result.ok || result.value.value === undefined) continue;
					if (column.type === "person" && !onlyPeople(result.value.value)) continue;
					cells[columnId] = result.value.value;
					columns = columns.map((c) => (c.id === columnId ? result.value.column : c));
				}
				if (Object.keys(cells).length > 0) {
					yield* MainDb.updateRowCells({ id, cells: JSON.stringify(cells), now, by });
				}
			}
			return yield* reply({ rowId: id });
		}

		case "deleteRow":
			if (!row) return yield* bad("invalid_row");
			yield* Trash.remove(row.id);
			return yield* reply();

		case "setTitle":
			if (!row) return yield* bad("invalid_row");
			yield* MainDb.updatePageTitle({ id: row.id, title: cleanTitle(body.title), now, by });
			return yield* reply();

		case "setCell": {
			if (!row) return yield* bad("invalid_row");
			const column = state.columns.find((c) => c.id === body.columnId);
			if (!column || column.id === TITLE_COLUMN) return yield* bad("invalid_column");
			if (column.type === "relation") return yield* setRelation(column, row.id, body.value);
			yield* writeCell(row, column, body.value);
			return yield* reply();
		}

		case "moveRow": {
			// Board drag: optionally into another group (`columnId` + `value`), and
			// optionally to a new place in the stored order (just before `beforeId`, or last).
			if (!row) return yield* bad("invalid_row");
			if (body.columnId !== undefined) {
				const column = state.columns.find((c) => c.id === body.columnId && canGroup(c));
				if (!column) return yield* bad("invalid_column");
				yield* writeCell(row, column, body.value);
			}
			if (body.beforeId !== undefined) {
				const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
				const order = placeBefore(
					state.rows.map((r) => r.id),
					row.id,
					beforeId,
				);
				if (!order) return yield* bad("invalid_before");
				yield* MainDb.setPageOrder({ ids: JSON.stringify(order) });
			}
			return yield* reply();
		}

		case "setView": {
			// Replaces one view (matched by id) with its new settings.
			const view = cleanView(body.view, state.columns);
			if (!state.views.some((v) => v.id === view.id)) return yield* bad("invalid_view");
			yield* saveViews(state.views.map((v) => (v.id === view.id ? view : v)));
			return yield* reply();
		}

		case "addView": {
			if (state.views.length >= MAX_VIEWS) return yield* bad("too_many_views");
			const view = newView(
				state.views,
				isLayout(body.layout) ? body.layout : "table",
				state.columns,
			);
			yield* saveViews([...state.views, view]);
			return yield* reply({ viewId: view.id });
		}

		case "renameView": {
			const name = cleanName(body.name, 60);
			if (!name || !state.views.some((v) => v.id === body.viewId))
				return yield* bad("invalid_view");
			yield* saveViews(state.views.map((v) => (v.id === body.viewId ? { ...v, name } : v)));
			return yield* reply();
		}

		case "deleteView": {
			if (state.views.length < 2 || !state.views.some((v) => v.id === body.viewId)) {
				return yield* bad("invalid_view");
			}
			yield* saveViews(state.views.filter((v) => v.id !== body.viewId));
			return yield* reply();
		}

		case "addOption": {
			// A new group on a board: an option of its select column.
			const column = state.columns.find(
				(c) =>
					c.id === body.columnId &&
					(c.type === "select" || c.type === "multi_select" || c.type === "status"),
			);
			const name = cleanName(body.name);
			if (!column || !name) return yield* bad("invalid_option");
			const result = cleanCell(column, { name });
			if (!result.ok) return yield* bad(result.error);
			yield* saveColumns(state.columns.map((c) => (c.id === column.id ? result.value.column : c)));
			return yield* reply();
		}

		case "addColumn": {
			if (body.type === "relation") return yield* addRelationColumn(body);
			if (body.type === "script") {
				// Starts as an example the editor opens on; `js` is empty until it's saved from there.
				const script = cleanScript(body.script) ?? { source: starterScript(state.columns), js: "" };
				const made = addColumn(state.columns, "script", body.name, undefined, undefined, script);
				if (!made.ok) return yield* bad(made.error);
				yield* saveColumns(made.value.columns);
				return yield* reply({ columnId: made.value.id });
			}
			if (body.type === "rollup") {
				// Starts on the first relation, showing the related rows' names.
				const rollup = yield* checkRollup(state, body.rollup);
				const made = addColumn(state.columns, "rollup", body.name, undefined, rollup);
				if (!made.ok) return yield* bad(made.error);
				yield* saveColumns(made.value.columns);
				return yield* reply({ columnId: made.value.id });
			}
			const result = addColumn(state.columns, body.type, body.name);
			if (!result.ok) return yield* bad(result.error);
			let columns = result.value.columns;
			// Optional starting options for a select (e.g. a board's Status groups).
			if (Array.isArray(body.options)) {
				for (const name of body.options.slice(0, 20)) {
					const column = columns.find((c) => c.id === result.value.id)!;
					const made = cleanCell(column, { name });
					if (made.ok) columns = columns.map((c) => (c.id === column.id ? made.value.column : c));
				}
			}
			yield* saveColumns(columns);
			return yield* reply({ columnId: result.value.id });
		}

		case "deleteColumn": {
			const column = state.columns.find((c) => c.id === body.columnId);
			const result = removeColumn(state.columns, body.columnId);
			if (!result.ok) return yield* bad(result.error);
			let columns = result.value;
			if (column?.type !== "relation" || !column.relation) {
				yield* saveColumns(columns);
				return yield* reply();
			}
			const { databaseId: otherId, twinId, sourceColumnId } = column.relation;
			const same = otherId === databaseId;
			if (sourceColumnId) {
				// The other side of a two-way relation: its owner becomes one-way.
				const unlink = (list: Column[]) =>
					list.map((c) => (c.id === sourceColumnId ? withoutTwin(c) : c));
				if (same) columns = unlink(columns);
				else yield* editColumns(otherId, unlink);
			} else {
				// The owner: its links go, and so does its other side.
				yield* MainDb.deleteColumnRelations({ columnId: column.id });
				if (twinId) {
					const drop = (list: Column[]) => list.filter((c) => c.id !== twinId);
					if (same) columns = drop(columns);
					else yield* editColumns(otherId, drop);
				}
			}
			yield* saveColumns(columns);
			return yield* reply({ touched: [otherId] });
		}

		case "setRollup": {
			const column = state.columns.find((c) => c.id === body.columnId && c.type === "rollup");
			if (!column) return yield* bad("invalid_column");
			const rollup = yield* checkRollup(state, body.rollup);
			yield* saveColumns(
				state.columns.map((c) => (c.id === column.id ? { ...c, rollup: rollup } : c)),
			);
			return yield* reply();
		}

		case "setScript": {
			const column = state.columns.find((c) => c.id === body.columnId && c.type === "script");
			if (!column) return yield* bad("invalid_column");
			const script = cleanScript(body.script);
			if (!script) return yield* bad("invalid_script");
			yield* saveColumns(state.columns.map((c) => (c.id === column.id ? { ...c, script } : c)));
			return yield* reply();
		}

		case "resizeColumn": {
			const result = resizeColumn(state.columns, body.columnId, body.width ?? null);
			if (!result.ok) return yield* bad(result.error);
			yield* saveColumns(result.value);
			return yield* reply();
		}

		case "renameColumn":
		case "setColumnType":
		case "moveColumn": {
			const result =
				body.op === "renameColumn"
					? renameColumn(state.columns, body.columnId, body.name)
					: body.op === "setColumnType"
						? setColumnType(state.columns, body.columnId, body.type)
						: moveColumn(state.columns, body.columnId, body.beforeId ?? null);
			if (!result.ok) return yield* bad(result.error);
			yield* saveColumns(result.value);
			return yield* reply();
		}
	}
});
