/**
 * Database changes from the table UI. One action takes `{op, databaseId, …}`
 * and answers with the whole database (`{state}`), so the browser just redraws.
 */
import { removePage } from "@modules/archive";
import { isPageId, MAX_TITLE_LENGTH, type database } from "@modules/db";
import { placePage } from "@modules/tree";
import {
	addRelations,
	clearRelationsFrom,
	clearRelationsTo,
	createDatabase,
	createRow,
	deleteColumnRelations,
	findDatabase,
	findPage,
	listDatabases,
	listRelations,
	listRows,
	listTitles,
	setPageOrder,
	updateDatabaseColumns,
	updateDatabaseView,
	updatePageTitle,
	updateRowCells,
} from "@space/db/main_db";
import type { QuickJSWASMModule } from "quickjs-emscripten-core";

import { columnValues, runSheet } from "../script/run";
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
} from "../script/script";
import {
	addColumn,
	cleanCell,
	cleanName,
	defaultColumns,
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
} from "./columns";
import { computeRollup, fnsFor, isRollupFn, type RollupConfig } from "./rollup";
import { cleanView, cleanViews, isLayout, MAX_VIEWS, newView, type View } from "./view";

type Db = Awaited<ReturnType<typeof database>>;

/** Rows a new database starts with, so there's somewhere to type. */
const STARTER_ROWS = 3;
const MAX_ROWS = 5000;

export const cleanTitle = (value: unknown) =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH) : "";

export async function databaseState(
	db: Db,
	id: string,
	{ rollups = true, scripts = rollups }: { rollups?: boolean; scripts?: boolean } = {},
): Promise<DatabaseState | null> {
	const found = await findDatabase(db, { id });
	if (!found) return null;
	const stored = await listRows(db, { databaseId: id });
	const columns = parseColumns(found.columns);
	const rows = stored.map((row) => {
		const cells = parseCells(row.cells);
		const formulas = takeFormulas(cells);
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
		const links = await listRelations(db, { databaseId: id });
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
			for (const page of await listTitles(db, { ids: JSON.stringify([...linked]) })) {
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
	};
	if (rollups) await addRollups(db, state);
	if (scripts) await addScripts(db, state);
	return state;
}

/**
 * Fills in script cells and formula cells. They're worked out together (so
 * they can read each other) in one sandbox run per load. Linked databases are
 * loaded without their own scripts and rollups, which rules out loops between
 * databases.
 */
async function addScripts(db: Db, state: DatabaseState): Promise<void> {
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
			linked.set(targetId, await databaseState(db, targetId, { rollups: false, scripts: false }));
		}
	}
	const input = sheetInput(state, linked);
	let engine: QuickJSWASMModule;
	try {
		// Loaded on first use, so code that never runs a script never loads the engine.
		engine = await (await import("../script/engine")).serverEngine();
	} catch (error) {
		console.error("[scripts] engine failed to load", error);
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
}

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
async function addRollups(db: Db, state: DatabaseState): Promise<void> {
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
				targetId === state.id ? state : await databaseState(db, targetId, { rollups: false }),
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
}

/** A valid rollup setting for this database (or the reason it isn't). */
async function checkRollup(
	db: Db,
	state: DatabaseState,
	input: unknown,
): Promise<{ ok: true; value: RollupConfig } | { ok: false; error: string }> {
	const raw = (input ?? {}) as Record<string, unknown>;
	const relation =
		state.columns.find((c) => c.id === raw.relationId && c.type === "relation") ??
		state.columns.find((c) => c.type === "relation");
	const targetId = relation?.relation?.databaseId;
	if (!relation || !targetId) return { ok: false, error: "needs_relation" };
	const target =
		targetId === state.id ? state : await databaseState(db, targetId, { rollups: false });
	if (!target) return { ok: false, error: "invalid_target" };
	const targetColumn =
		target.columns.find((c) => c.id === raw.targetId && c.type !== "rollup") ??
		target.columns.find((c) => c.type === "title")!;
	const allowed = fnsFor(targetColumn.type);
	const fn = isRollupFn(raw.fn) && allowed.includes(raw.fn) ? raw.fn : "show_original";
	return { ok: true, value: { relationId: relation.id, targetId: targetColumn.id, fn } };
}

/** Changes another database's columns (the twin side of a two-way relation). */
async function editColumns(db: Db, id: string, change: (columns: Column[]) => Column[]) {
	const found = await findDatabase(db, { id });
	if (!found) return;
	const columns = change(parseColumns(found.columns));
	await updateDatabaseColumns(db, { id, columns: JSON.stringify(columns), now: Date.now() });
}

const withoutTwin = (column: Column): Column => {
	if (!column.relation) return column;
	const { twinId: _, ...relation } = column.relation;
	return { ...column, relation };
};

/** Makes a database (full-page in a folder, or inline in `hostId`) with starter rows. */
export async function newDatabase(
	db: Db,
	options: { folderId: string | null; hostId: string | null; title?: string },
): Promise<string> {
	const id = crypto.randomUUID();
	const now = Date.now();
	await createDatabase(db, {
		id,
		folderId: options.folderId,
		hostId: options.hostId,
		title: options.title ?? "",
		columns: JSON.stringify(defaultColumns()),
		now,
	});
	for (let i = 0; i < STARTER_ROWS; i++) {
		await createRow(db, { id: crypto.randomUUID(), databaseId: id, title: "", now: now + i });
	}
	return id;
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Runs one table change. `pageId` is the page the request came from (it hosts new inline databases). */
export async function runDatabaseOp(
	db: Db,
	pageId: string,
	body: Record<string, unknown>,
): Promise<Response> {
	const now = Date.now();

	if (body.op === "create") {
		const host = await findPage(db, { id: pageId });
		if (!host || host.kind === "database") return bad("invalid_host");
		const id = await newDatabase(db, { folderId: null, hostId: pageId });
		return Response.json({ state: await databaseState(db, id) });
	}

	if (body.op === "databases") {
		// For choosing a relation's target.
		const all = await listDatabases(db, {});
		return Response.json({
			databases: all.map((d) => ({ id: d.id, title: d.title, hostId: d.host_id })),
		});
	}

	const databaseId =
		typeof body.databaseId === "string" && isPageId(body.databaseId) ? body.databaseId : null;
	const state = databaseId ? await databaseState(db, databaseId) : null;
	if (!databaseId || !state) return bad("not_found", 404);

	const saveViews = (views: View[]) =>
		updateDatabaseView(db, { id: databaseId, view: JSON.stringify({ views }), now });
	const saveColumns = (columns: Column[]) =>
		updateDatabaseColumns(db, {
			id: databaseId,
			columns: JSON.stringify(storable(columns)),
			now,
		});
	const row =
		typeof body.rowId === "string" ? state.rows.find((r) => r.id === body.rowId) : undefined;
	const reply = async (extra: Record<string, unknown> = {}) =>
		Response.json({ state: await databaseState(db, databaseId), ...extra });

	switch (body.op) {
		case "get":
			return Response.json({ state });

		case "delete":
			await removePage(db, databaseId); // to the archive
			return Response.json({ state: null });

		case "rename":
			await updatePageTitle(db, { id: databaseId, title: cleanTitle(body.title), now });
			return reply();

		case "addRow": {
			if (state.rows.length >= MAX_ROWS) return bad("too_many_rows");
			const id = crypto.randomUUID();
			await createRow(db, { id, databaseId, title: cleanTitle(body.title), now });
			// Values that make the row match the current filters (bad ones are skipped).
			if (body.cells && typeof body.cells === "object") {
				let columns = state.columns;
				const cells: Record<string, unknown> = {};
				for (const [columnId, value] of Object.entries(body.cells)) {
					const column = columns.find((c) => c.id === columnId);
					if (!column || column.id === TITLE_COLUMN) continue;
					const result = cleanCell(column, value);
					if (!result.ok || result.value.value === undefined) continue;
					cells[columnId] = result.value.value;
					columns = columns.map((c) => (c.id === columnId ? result.value.column : c));
				}
				if (Object.keys(cells).length > 0) {
					await updateRowCells(db, { id, cells: JSON.stringify(cells), now });
				}
			}
			return reply({ rowId: id });
		}

		case "deleteRow":
			if (!row) return bad("invalid_row");
			await removePage(db, row.id); // to the archive
			return reply();

		case "setTitle":
			if (!row) return bad("invalid_row");
			await updatePageTitle(db, { id: row.id, title: cleanTitle(body.title), now });
			return reply();

		case "setCell": {
			if (!row) return bad("invalid_row");
			const column = state.columns.find((c) => c.id === body.columnId);
			if (!column || column.id === TITLE_COLUMN) return bad("invalid_column");
			if (column.type === "relation") return setRelation(column, row.id, body.value);
			const error = await writeCell(row, column, body.value);
			return error ? bad(error) : reply();
		}

		case "moveRow": {
			// Board drag: optionally into another group (`columnId` + `value`), and
			// optionally to a new place in the stored order (just before `beforeId`, or last).
			if (!row) return bad("invalid_row");
			if (body.columnId !== undefined) {
				const column = state.columns.find((c) => c.id === body.columnId && c.type === "select");
				if (!column) return bad("invalid_column");
				const error = await writeCell(row, column, body.value);
				if (error) return bad(error);
			}
			if (body.beforeId !== undefined) {
				const beforeId = typeof body.beforeId === "string" ? body.beforeId : null;
				const order = placePage(
					state.rows.map((r) => r.id),
					row.id,
					beforeId,
				);
				if (!order) return bad("invalid_before");
				await setPageOrder(db, { ids: JSON.stringify(order) });
			}
			return reply();
		}

		case "setView": {
			// Replaces one view (matched by id) with its new settings.
			const view = cleanView(body.view, state.columns);
			if (!state.views.some((v) => v.id === view.id)) return bad("invalid_view");
			await saveViews(state.views.map((v) => (v.id === view.id ? view : v)));
			return reply();
		}

		case "addView": {
			if (state.views.length >= MAX_VIEWS) return bad("too_many_views");
			const view = newView(
				state.views,
				isLayout(body.layout) ? body.layout : "table",
				state.columns,
			);
			await saveViews([...state.views, view]);
			return reply({ viewId: view.id });
		}

		case "renameView": {
			const name = cleanName(body.name, 60);
			if (!name || !state.views.some((v) => v.id === body.viewId)) return bad("invalid_view");
			await saveViews(state.views.map((v) => (v.id === body.viewId ? { ...v, name } : v)));
			return reply();
		}

		case "deleteView": {
			if (state.views.length < 2 || !state.views.some((v) => v.id === body.viewId)) {
				return bad("invalid_view");
			}
			await saveViews(state.views.filter((v) => v.id !== body.viewId));
			return reply();
		}

		case "addOption": {
			// A new group on a board: an option of its select column.
			const column = state.columns.find(
				(c) => c.id === body.columnId && (c.type === "select" || c.type === "multi_select"),
			);
			const name = cleanName(body.name);
			if (!column || !name) return bad("invalid_option");
			const result = cleanCell(column, { name });
			if (!result.ok) return bad(result.error);
			await saveColumns(state.columns.map((c) => (c.id === column.id ? result.value.column : c)));
			return reply();
		}

		case "addColumn": {
			if (body.type === "relation") return addRelationColumn(body);
			if (body.type === "script") {
				// Starts as an example the editor opens on; `js` is empty until it's saved from there.
				const script = cleanScript(body.script) ?? { source: starterScript(state.columns), js: "" };
				const made = addColumn(state.columns, "script", body.name, undefined, undefined, script);
				if (!made.ok) return bad(made.error);
				await saveColumns(made.value.columns);
				return reply({ columnId: made.value.id });
			}
			if (body.type === "rollup") {
				// Starts on the first relation, showing the related rows' names.
				const rollup = await checkRollup(db, state, body.rollup);
				if (!rollup.ok) return bad(rollup.error);
				const made = addColumn(state.columns, "rollup", body.name, undefined, rollup.value);
				if (!made.ok) return bad(made.error);
				await saveColumns(made.value.columns);
				return reply({ columnId: made.value.id });
			}
			const result = addColumn(state.columns, body.type, body.name);
			if (!result.ok) return bad(result.error);
			let columns = result.value.columns;
			// Optional starting options for a select (e.g. a board's Status groups).
			if (Array.isArray(body.options)) {
				for (const name of body.options.slice(0, 20)) {
					const column = columns.find((c) => c.id === result.value.id)!;
					const made = cleanCell(column, { name });
					if (made.ok) columns = columns.map((c) => (c.id === column.id ? made.value.column : c));
				}
			}
			await saveColumns(columns);
			return reply({ columnId: result.value.id });
		}

		case "deleteColumn": {
			const column = state.columns.find((c) => c.id === body.columnId);
			const result = removeColumn(state.columns, body.columnId);
			if (!result.ok) return bad(result.error);
			let columns = result.value;
			if (column?.type !== "relation" || !column.relation) {
				await saveColumns(columns);
				return reply();
			}
			const { databaseId: otherId, twinId, sourceColumnId } = column.relation;
			const same = otherId === databaseId;
			if (sourceColumnId) {
				// The other side of a two-way relation: its owner becomes one-way.
				const unlink = (list: Column[]) =>
					list.map((c) => (c.id === sourceColumnId ? withoutTwin(c) : c));
				if (same) columns = unlink(columns);
				else await editColumns(db, otherId, unlink);
			} else {
				// The owner: its links go, and so does its other side.
				await deleteColumnRelations(db, { columnId: column.id });
				if (twinId) {
					const drop = (list: Column[]) => list.filter((c) => c.id !== twinId);
					if (same) columns = drop(columns);
					else await editColumns(db, otherId, drop);
				}
			}
			await saveColumns(columns);
			return reply({ touched: [otherId] });
		}

		case "setRollup": {
			const column = state.columns.find((c) => c.id === body.columnId && c.type === "rollup");
			if (!column) return bad("invalid_column");
			const rollup = await checkRollup(db, state, body.rollup);
			if (!rollup.ok) return bad(rollup.error);
			await saveColumns(
				state.columns.map((c) => (c.id === column.id ? { ...c, rollup: rollup.value } : c)),
			);
			return reply();
		}

		case "setScript": {
			const column = state.columns.find((c) => c.id === body.columnId && c.type === "script");
			if (!column) return bad("invalid_column");
			const script = cleanScript(body.script);
			if (!script) return bad("invalid_script");
			await saveColumns(state.columns.map((c) => (c.id === column.id ? { ...c, script } : c)));
			return reply();
		}

		case "resizeColumn": {
			const result = resizeColumn(state.columns, body.columnId, body.width ?? null);
			if (!result.ok) return bad(result.error);
			await saveColumns(result.value);
			return reply();
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
			if (!result.ok) return bad(result.error);
			await saveColumns(result.value);
			return reply();
		}

		default:
			return bad("invalid_op");
	}

	/** Stores one cell (creating a select option if the value names a new one). Returns an error code. */
	async function writeCell(
		row: DatabaseState["rows"][number],
		column: Column,
		value: unknown,
	): Promise<string | null> {
		const cells = { ...row.cells };
		if (isStoredFormula(value)) {
			// A formula (`{$formula: {source, js, error?}}`), compiled by the browser.
			if (!canHoldFormula(column)) return "invalid_value";
			const config = cleanScript(value.$formula);
			if (!config) return "invalid_script";
			cells[column.id] = { $formula: config };
		} else {
			const result = cleanCell(column, value);
			if (!result.ok) return result.error;
			if (result.value.column !== column) {
				await saveColumns(
					state!.columns.map((c) => (c.id === column.id ? result.value.column : c)),
				);
			}
			if (result.value.value === undefined) delete cells[column.id];
			else cells[column.id] = result.value.value;
		}
		// The row's other formulas go back where their worked-out values were.
		for (const [id, config] of Object.entries(row.formulas ?? {})) {
			if (id !== column.id) cells[id] = { $formula: config };
		}
		// Relation, rollup and script values are worked out on load, never stored.
		for (const c of state!.columns) {
			if (c.type === "relation" || c.type === "rollup" || c.type === "script") delete cells[c.id];
		}
		await updateRowCells(db, { id: row.id, cells: JSON.stringify(cells), now });
		return null;
	}

	/** Replaces the rows a relation cell links to. */
	async function setRelation(column: Column, rowId: string, value: unknown) {
		const relation = column.relation;
		if (!relation) return bad("invalid_column");
		const result = cleanCell(column, value ?? []);
		if (!result.ok) return bad(result.error);
		const ids = (result.value.value as string[] | undefined) ?? [];
		const allowed = new Set(
			(await listRows(db, { databaseId: relation.databaseId })).map((r) => r.id),
		);
		const keep = ids.filter((id) => allowed.has(id));
		const owner = linkOwner(column);
		const backwards = Boolean(relation.sourceColumnId);
		if (backwards) await clearRelationsTo(db, { columnId: owner, toId: rowId });
		else await clearRelationsFrom(db, { columnId: owner, fromId: rowId });
		if (keep.length > 0) {
			const pairs = keep.map((id) => (backwards ? [id, rowId] : [rowId, id]));
			await addRelations(db, { columnId: owner, pairs: JSON.stringify(pairs) });
		}
		return reply({ touched: [relation.databaseId] });
	}

	/** `{relation: {databaseId, twoWay}}`: a relation column, and its other side when two-way. */
	async function addRelationColumn(input: Record<string, unknown>) {
		const here = state!;
		const config = (input.relation ?? {}) as { databaseId?: unknown; twoWay?: unknown };
		const targetId =
			typeof config.databaseId === "string" && isPageId(config.databaseId)
				? config.databaseId
				: null;
		const same = targetId === here.id;
		const target = targetId && !same ? await findDatabase(db, { id: targetId }) : null;
		if (!targetId || (!same && !target)) return bad("invalid_target");
		const targetTitle = (same ? here.title : target!.title).trim() || "Untitled";

		const made = addColumn(here.columns, "relation", input.name ?? targetTitle, {
			databaseId: targetId,
		});
		if (!made.ok) return bad(made.error);
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
					await updateDatabaseColumns(db, {
						id: targetId,
						columns: JSON.stringify(twin.value.columns),
						now,
					});
					columns = setTwin(twin.value.id);
				}
			}
		}
		await saveColumns(columns);
		return reply({ columnId: ownerId, touched: [targetId] });
	}
}
