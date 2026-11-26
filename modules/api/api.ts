/**
 * What the API and the MCP server do, on top of the app's own modules: pages
 * with their content as HTML, Markdown or the editor's JSON, databases and
 * their rows with properties by name, search, comments, and writing pages.
 * Changes are made as the token's owner (see `modules/auth/tokens.ts`).
 */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, NotFound } from "spacefn";

import Env from "#configs/env.ts";
import { isId } from "#lib/ids.ts";
import { cleanTitle } from "#lib/titles.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Comments from "#modules/comments/comments.ts";
import {
	readCell,
	TITLE_COLUMN,
	type Column,
	type DatabaseState,
	type FileRef,
	type Row,
	type SelectOption,
} from "#modules/database/columns.ts";
import { databaseState, runOp } from "#modules/database/database.ts";
import { applyView, opsFor, type Filter, type Sort, type View } from "#modules/database/view.ts";
import * as Pages from "#modules/pages/pages.ts";
import * as Search from "#modules/search/search.ts";
import * as Trash from "#modules/trash/trash.ts";
import MainDb from "#space/db/main.ts";

import { fromMarkdown, markdownBlocks } from "./markdown.ts";
import { refsIn, toHtml, toMarkdown, type Refs } from "./render.ts";
import { markQuote } from "./sections.ts";

export const FORMATS = ["html", "markdown", "json"] as const;
export type Format = (typeof FORMATS)[number];

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 100;

/** How content links to pages and files: templates with `{id}`, and `{key}` or `{path}`. */
export interface Links {
	pageUrl?: string | undefined;
	fileUrl?: string | undefined;
}

const bad = (message: string) => new BadRequest({ message });
const notFound = (what = "page") => new NotFound({ message: `No such ${what}` });
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Where pages and files are linked to: the app and its API, unless the caller says otherwise. */
const hrefs = Effect.fn("Api.hrefs")(function* (links: Links = {}) {
	const { ORIGIN } = yield* Env;
	const page = links.pageUrl ?? `${ORIGIN}/p/{id}`;
	const file = links.fileUrl ?? `${ORIGIN}/api/v1/files/{key}`;
	return {
		pageHref: (id: string) => page.replaceAll("{id}", id),
		fileHref: (path: string) =>
			file.replaceAll("{path}", path).replaceAll("{key}", path.replace(/^\/files\//, "")),
	};
});

/** What rendering these documents needs from the database. */
const refsFor = Effect.fn("Api.refsFor")(function* (states: unknown[], links: Links) {
	const pageIds = new Set<string>();
	const syncIds = new Set<string>();
	for (const state of states) {
		const found = refsIn(state);
		found.pageIds.forEach((id) => pageIds.add(id));
		found.syncIds.forEach((id) => syncIds.add(id));
	}
	const titles: Record<string, string> = {};
	if (pageIds.size > 0)
		for (const row of yield* MainDb.pages.listTitles({ ids: JSON.stringify([...pageIds]) }))
			titles[row.id] = row.title;
	const synced: Refs["synced"] = {};
	if (syncIds.size > 0)
		for (const row of yield* MainDb.synced.find({ ids: JSON.stringify([...syncIds]) })) {
			const content = parseJson(row.content);
			if (Array.isArray(content)) synced[row.id] = content as Refs["synced"][string];
		}
	return { titles, synced, ...(yield* hrefs(links)) } satisfies Refs;
});

export const parseJson = (text: string | null): unknown => {
	if (!text) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
};

const render = (state: unknown, format: Format, refs: Refs) =>
	format === "json" ? state : format === "markdown" ? toMarkdown(state, refs) : toHtml(state, refs);

// ---------------------------------------------------------------- properties

/** A cell as the API shows it: names, not ids, and plain values. */
function propertyValue(column: Column, row: Row, state: DatabaseState, refs: Refs): unknown {
	const raw = row.cells[column.id];
	const value = readCell(column, raw);
	switch (column.type) {
		case "select":
			return (value as SelectOption | null)?.name ?? null;
		case "multi_select":
			return (value as SelectOption[]).map((o) => o.name);
		case "relation":
			return (value as string[]).map((id) => ({ id, title: state.titles[id] ?? "" }));
		case "files":
			return (value as FileRef[]).map((f) => ({
				name: f.name,
				key: f.key,
				url: refs.fileHref(`/files/${f.key}`),
			}));
		case "created_time":
		case "last_edited_time":
			return iso(value as number | null);
		case "created_by":
		case "last_edited_by":
			return (value as string[])[0] ?? null;
		case "script":
			return value && typeof value === "object" && !Array.isArray(value) ? null : value;
		default:
			return value;
	}
}

const propertiesOf = (state: DatabaseState, row: Row, refs: Refs) =>
	Object.fromEntries(
		state.columns
			.filter((c) => c.id !== TITLE_COLUMN)
			.map((c) => [c.name, propertyValue(c, row, state, refs)]),
	);

/**
 * A database's properties: name, type, a select's choices, what a relation
 * links to, what a rollup works out, and a script's source.
 */
const schemaOf = (
	state: DatabaseState,
	related: ReadonlyMap<string, DatabaseState> = new Map(),
) => {
	const nameOf = (id: string | undefined) => state.columns.find((c) => c.id === id)?.name ?? null;
	return state.columns.map((c) => ({
		name: c.name,
		type: c.type,
		...(c.options ? { options: c.options.map((o) => ({ name: o.name, color: o.color })) } : {}),
		...(c.relation
			? {
					relation: {
						databaseId: c.relation.databaseId,
						twoWay: Boolean(c.relation.twinId || c.relation.sourceColumnId),
					},
				}
			: {}),
		...(c.rollup
			? {
					rollup: {
						relation: nameOf(c.rollup.relationId),
						property:
							related
								.get(
									state.columns.find((r) => r.id === c.rollup!.relationId)?.relation?.databaseId ??
										"",
								)
								?.columns.find((t) => t.id === c.rollup!.targetId)?.name ?? null,
						function: c.rollup.fn,
					},
				}
			: {}),
		...(c.script
			? { script: c.script.source, ...(c.script.error ? { error: c.script.error } : {}) }
			: {}),
	}));
};

/** The column a property name means (any case), or a 400 naming the ones there are. */
export const columnNamed = (state: DatabaseState, name: string) => {
	const found =
		state.columns.find((c) => c.name === name) ??
		state.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
	if (found) return Effect.succeed(found);
	return Effect.fail(
		bad(`No property "${name}": there are ${state.columns.map((c) => `"${c.name}"`).join(", ")}`),
	);
};

/** A value written by name into what the table's own `setCell` takes. */
function cellInput(column: Column, value: unknown): unknown {
	if (value === null || value === undefined) return null;
	switch (column.type) {
		case "select":
			return typeof value === "string" ? { name: value } : value;
		case "multi_select":
			return (Array.isArray(value) ? value : [value]).map((v) =>
				typeof v === "string" ? { name: v } : v,
			);
		case "relation":
			return (Array.isArray(value) ? value : [value]).map((v) =>
				v && typeof v === "object" && "id" in v ? (v as { id: unknown }).id : v,
			);
		case "person":
			return Array.isArray(value) ? value : [value];
		case "files":
			return (Array.isArray(value) ? value : [value]).map((v) => {
				const file = (v ?? {}) as { key?: unknown; url?: unknown; name?: unknown };
				const from = typeof file.key === "string" ? file.key : String(file.url ?? "");
				return { key: from.replace(/^.*\/files\//, ""), name: file.name };
			});
		default:
			return value;
	}
}

/** Other names agents use for the table's filter operators. */
const OP_ALIASES: Record<string, string[]> = {
	is: ["eq", "equals"],
	is_not: ["neq", "not"],
	eq: ["is", "equals"],
	neq: ["is_not", "not"],
	gt: ["after"],
	lt: ["before"],
	gte: ["on_or_after"],
	lte: ["on_or_before"],
	after: ["gt"],
	before: ["lt"],
	on_or_after: ["gte"],
	on_or_before: ["lte"],
	empty: ["is_empty"],
	not_empty: ["is_not_empty"],
	checked: ["is_checked"],
	unchecked: ["is_not_checked"],
};

/** The operator `name` means for `column`, or `undefined`. */
const opNamed = (column: Column, name: string) =>
	opsFor(column).find((o) => o.op === name || OP_ALIASES[o.op]?.includes(name));

/**
 * One `where` entry as table filters. A plain value means equality (containment
 * for lists, and checked or not for a checkbox); an object names operators,
 * all of which must hold: `{"after": "2026-11-01", "before": "2026-12-01"}`.
 */
function filtersFor(column: Column, value: unknown): Filter[] | string {
	const ops = opsFor(column).map((o) => o.op);
	const filter = (op: string, v?: string | number): Filter => ({
		id: crypto.randomUUID(),
		columnId: column.id,
		op,
		...(v === undefined ? {} : { value: v }),
	});
	const option = (name: unknown) => {
		const found = column.options?.find(
			(o) => o.name.toLowerCase() === String(name).trim().toLowerCase(),
		);
		return found
			? found.id
			: `No option "${String(name)}" in "${column.name}"; there are ${column.options?.map((o) => `"${o.name}"`).join(", ") || "none"}`;
	};
	/** The value as the filter compares it, or a problem with it. */
	const operand = (v: unknown): { ok: string | number } | string => {
		if (column.type === "select" || column.type === "multi_select") {
			const id = option(v);
			return column.options?.some((o) => o.id === id) ? { ok: id } : id;
		}
		if (ops.includes("gt")) {
			const n = typeof v === "number" ? v : Number(v);
			return Number.isFinite(n)
				? { ok: n }
				: `"${column.name}" is a number, not ${JSON.stringify(v)}`;
		}
		if (ops.includes("after") && column.type !== "time" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
			return `"${column.name}" compares dates as YYYY-MM-DD, not ${JSON.stringify(v)}`;
		return { ok: String(v) };
	};

	if (column.type === "checkbox" && (typeof value !== "object" || value === null)) {
		const on = value === true || /^(true|1|yes)$/i.test(String(value));
		return [filter(on ? "checked" : "unchecked")];
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		const first = ops.includes("is") ? "is" : ops.includes("eq") ? "eq" : "contains";
		const v = operand(value);
		return typeof v === "string" ? v : [filter(first, v.ok)];
	}
	const out: Filter[] = [];
	for (const [name, raw] of Object.entries(value)) {
		const found = opNamed(column, name);
		if (!found)
			return `"${column.name}" (${column.type}) has no "${name}"; it takes ${ops.join(", ")}`;
		if (!found.needsValue) {
			// `{"empty": false}` means not empty, and so on.
			const flip: Record<string, string> = {
				empty: "not_empty",
				not_empty: "empty",
				checked: "unchecked",
				unchecked: "checked",
			};
			out.push(filter(raw === false ? (flip[found.op] ?? found.op) : found.op));
			continue;
		}
		const v = operand(raw);
		if (typeof v === "string") return v;
		out.push(filter(found.op, v.ok));
	}
	return out;
}

/** A `where` object's filters, all of which a row must match. */
export const whereFilters = Effect.fn("Api.whereFilters")(function* (
	state: DatabaseState,
	where: Readonly<Record<string, unknown>>,
) {
	const filters: Filter[] = [];
	for (const [name, value] of Object.entries(where)) {
		const found = filtersFor(yield* columnNamed(state, name), value);
		if (typeof found === "string") return yield* bad(found);
		filters.push(...found);
	}
	return filters;
});

/** A view as an agent reads it: its settings, with properties and options by name. */
export const describeView = (state: DatabaseState, view: View) => {
	const byId = new Map(state.columns.map((c) => [c.id, c]));
	const name = (id: string | undefined) => (id ? (byId.get(id)?.name ?? null) : null);
	return {
		id: view.id,
		name: view.name,
		layout: view.layout,
		filters: view.filters.flatMap((f) => {
			const column = byId.get(f.columnId);
			if (!column) return [];
			const option = column.options?.find((o) => o.id === f.value);
			return [
				{
					property: column.name,
					operator: f.op,
					...(f.value === undefined ? {} : { value: option ? option.name : f.value }),
				},
			];
		}),
		sort: view.sorts.flatMap((s) => {
			const n = name(s.columnId);
			return n === null ? [] : [s.direction === "desc" ? `-${n}` : n];
		}),
		...(view.groupBy ? { groupBy: name(view.groupBy) } : {}),
		...(view.dateBy ? { dateBy: name(view.dateBy) } : {}),
		...(view.endBy ? { endBy: name(view.endBy) } : {}),
		...(view.rowNumbers === undefined ? {} : { rowNumbers: view.rowNumbers }),
	};
};

// ---------------------------------------------------------------- pages

export const ReadOptions = Schema.Struct({
	format: Schema.optional(Schema.Literals(FORMATS)),
	pageUrl: Schema.optional(Schema.String),
	fileUrl: Schema.optional(Schema.String),
});

const kindOf = (page: { kind: string; database_id: string | null }) =>
	page.kind === "database" ? "database" : page.database_id ? "row" : "page";

/** Every page not in Trash: pages, databases and database rows. */
export const listPages = Effect.fn("Api.listPages")(function* (
	options: { kind?: string | undefined; database?: string | undefined } = {},
) {
	const { ORIGIN } = yield* Env;
	const folders = new Map((yield* MainDb.folders.list()).map((f) => [f.id, f]));
	/** A folder's path, like `Blog/Drafts`. */
	const pathOf = (id: string | null) => {
		const names: string[] = [];
		for (
			let at = id ? folders.get(id) : undefined;
			at;
			at = at.parent_id ? folders.get(at.parent_id) : undefined
		) {
			names.unshift(at.name);
			if (names.length > 20) break;
		}
		return names.join("/") || null;
	};
	const pages = (yield* MainDb.pages.listLive()).map((page) => ({
		id: page.id,
		title: page.title,
		kind: kindOf(page),
		icon: page.icon,
		folder: page.folder_id ? { id: page.folder_id, path: pathOf(page.folder_id) } : null,
		databaseId: page.database_id,
		hostId: page.host_id,
		createdAt: iso(page.created_at),
		updatedAt: iso(page.updated_at),
		createdBy: page.created_by,
		updatedBy: page.updated_by,
		url: `${ORIGIN}/p/${page.id}`,
	}));
	return pages.filter(
		(page) =>
			(!options.kind || page.kind === options.kind) &&
			(!options.database || page.databaseId === options.database),
	);
});

/** The folders, each with its path. */
export const listFolders = Effect.gen(function* () {
	const folders = yield* MainDb.folders.list();
	const byId = new Map(folders.map((f) => [f.id, f]));
	const path = (id: string) => {
		const names: string[] = [];
		for (
			let at = byId.get(id);
			at && names.length < 20;
			at = at.parent_id ? byId.get(at.parent_id) : undefined
		)
			names.unshift(at.name);
		return names.join("/");
	};
	return folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parent_id, path: path(f.id) }));
});

/** A page that isn't in Trash, or a 404. */
export const livePage = Effect.fn("Api.livePage")(function* (id: string) {
	if (!isId(id)) return yield* notFound();
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page || page.archived_at !== null) return yield* notFound();
	return page;
});

/** One page: what it is, its properties when it's a row, and its content in `format`. */
export const getPage = Effect.fn("Api.getPage")(function* (
	id: string,
	options: typeof ReadOptions.Type = {},
) {
	const page = yield* livePage(id);
	const { ORIGIN } = yield* Env;
	const state = parseJson(page.content) ?? fromMarkdown("");
	const format = options.format ?? "html";
	const refs = yield* refsFor([state], options);
	const database = page.database_id ? yield* databaseState(page.database_id) : null;
	const row = database?.rows.find((r) => r.id === page.id);
	return {
		id: page.id,
		title: page.title,
		kind: kindOf(page),
		icon: page.icon,
		cover: page.cover?.startsWith("/files/") ? refs.fileHref(page.cover) : page.cover,
		folderId: page.folder_id,
		database: database ? { id: database.id, title: database.title } : null,
		properties: database && row ? propertiesOf(database, row, refs) : null,
		/** The pages that link to this one. */
		backlinks: (yield* MainDb.links.listBacklinks({ id })).map((link) => ({
			id: link.id,
			title: link.title,
		})),
		createdAt: iso(page.created_at),
		updatedAt: iso(page.updated_at),
		createdBy: page.created_by,
		updatedBy: page.updated_by,
		url: `${ORIGIN}/p/${page.id}`,
		format,
		content: render(state, format, refs),
	};
});

export const listDatabases = Effect.map(MainDb.databases.list(), (rows) =>
	rows.map((d) => ({ id: d.id, title: d.title, hostId: d.host_id })),
);

/** A database: its title and properties. */
export const getDatabase = Effect.fn("Api.getDatabase")(function* (id: string) {
	const state = isId(id) ? yield* databaseState(id) : null;
	if (!state) return yield* notFound("database");
	// The databases its relations link to, for naming what its rollups roll up.
	const related = new Map<string, DatabaseState>();
	for (const c of state.columns) {
		const other = c.relation?.databaseId;
		if (!other || related.has(other)) continue;
		const found = other === id ? state : yield* databaseState(other, { rollups: false });
		if (found) related.set(other, found);
	}
	return {
		id: state.id,
		title: state.title,
		hostId: state.hostId,
		properties: schemaOf(state, related),
		views: state.views.map((v) => describeView(state, v)),
		people: state.people,
		rows: state.rows.length,
	};
});

const Where = Schema.Record(Schema.String, Schema.Unknown);

export const RowsQuery = Schema.Struct({
	/** Property name → a value, or `{operator: value}`; every one must match. */
	where: Schema.optional(Where),
	/** Groups like `where`; a row must match at least one (on top of `where`). */
	whereAny: Schema.optional(Schema.Array(Where)),
	sort: Schema.optional(Schema.Array(Schema.String)),
	view: Schema.optional(Schema.String),
	limit: Schema.optional(Schema.Number),
	offset: Schema.optional(Schema.Number),
	content: Schema.optional(Schema.Literals(FORMATS)),
	pageUrl: Schema.optional(Schema.String),
	fileUrl: Schema.optional(Schema.String),
});

/**
 * A database's rows with their properties. `where` keeps rows whose property
 * is the value (contains it, for lists), or passes the table's operators
 * (`{"after": "2026-11-01"}`); `whereAny` keeps rows that pass any one of its
 * groups; `sort` orders by properties, `-Name` for descending; `view` starts
 * from a view's own filters and sorts.
 * `content` adds each row's page content in that format.
 */
export const queryRows = Effect.fn("Api.queryRows")(function* (
	id: string,
	query: typeof RowsQuery.Type,
) {
	const state = isId(id) ? yield* databaseState(id) : null;
	if (!state) return yield* notFound("database");
	const view = query.view
		? state.views.find(
				(v) => v.id === query.view || v.name.toLowerCase() === query.view!.toLowerCase(),
			)
		: undefined;
	if (query.view && !view) return yield* bad(`No view "${query.view}"`);
	const filters: Filter[] = [
		...(view?.filters ?? []),
		...(yield* whereFilters(state, query.where ?? {})),
	];
	// Each of `whereAny` is a group of filters; a row may match any one of them.
	const groups: Filter[][] = [];
	for (const where of query.whereAny ?? []) groups.push(yield* whereFilters(state, where));
	const sorts: Sort[] = [];
	for (const entry of query.sort ?? []) {
		const desc = entry.startsWith("-");
		const column = yield* columnNamed(state, desc ? entry.slice(1) : entry);
		sorts.push({ columnId: column.id, direction: desc ? "desc" : "asc" });
	}
	const matching = applyView(
		state.columns,
		state.rows,
		{ filters, sorts: [] },
		new Set(),
		state.titles,
	);
	const anyOf =
		groups.length === 0
			? matching
			: (() => {
					const hits = new Set(
						groups.flatMap((group) =>
							applyView(
								state.columns,
								matching,
								{ filters: group, sorts: [] },
								new Set(),
								state.titles,
							).map((r) => r.id),
						),
					);
					return matching.filter((r) => hits.has(r.id));
				})();
	const shown = applyView(
		state.columns,
		anyOf,
		{ filters: [], sorts: sorts.length > 0 ? sorts : (view?.sorts ?? []) },
		new Set(),
		state.titles,
	);
	const offset = Math.max(0, Math.floor(query.offset ?? 0));
	const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
	const page = shown.slice(offset, offset + limit);

	const contents = new Map<string, unknown>();
	if (query.content)
		for (const row of yield* MainDb.databases.listRowContents({ databaseId: id }))
			contents.set(row.id, parseJson(row.content) ?? fromMarkdown(""));
	const refs = yield* refsFor([...contents.values()], query);
	const { ORIGIN } = yield* Env;
	return {
		database: { id: state.id, title: state.title },
		total: shown.length,
		nextOffset: offset + limit < shown.length ? offset + limit : null,
		rows: page.map((row) => ({
			id: row.id,
			title: row.title,
			icon: row.icon ?? null,
			cover: row.cover?.startsWith("/files/") ? refs.fileHref(row.cover) : (row.cover ?? null),
			url: `${ORIGIN}/p/${row.id}`,
			properties: propertiesOf(state, row, refs),
			...(query.content ? { content: render(contents.get(row.id), query.content, refs) } : {}),
		})),
	};
});

export const search = Effect.fn("Api.search")(function* (q: string) {
	const { results } = yield* Search.find({ q });
	const { ORIGIN } = yield* Env;
	return results.map((r) => ({
		id: r.id,
		title: r.title,
		kind: r.kind,
		icon: r.icon,
		parent: r.parent,
		snippet: r.snippet,
		url: `${ORIGIN}${r.href}`,
	}));
});

// ---------------------------------------------------------------- writing

const PropertiesInput = Schema.optional(Schema.Record(Schema.String, Schema.Unknown));

export const NewPage = Schema.Struct({
	title: Schema.optional(Schema.String),
	/** The content, as Markdown. */
	markdown: Schema.optional(Schema.String),
	/** Or as the editor's JSON (`{root: …}`). */
	doc: Schema.optional(Schema.Unknown),
	/** A folder to put it in; the top level otherwise. */
	folder: Schema.optional(Schema.NullOr(Schema.String)),
	/** A database to add it to, as a row. */
	database: Schema.optional(Schema.String),
	icon: Schema.optional(Schema.String),
	properties: PropertiesInput,
});

export const PageChanges = Schema.Struct({
	title: Schema.optional(Schema.String),
	/** Replaces the content. */
	markdown: Schema.optional(Schema.String),
	doc: Schema.optional(Schema.Unknown),
	/** Adds to the end of the content. */
	append: Schema.optional(Schema.String),
	icon: Schema.optional(Schema.String),
	/** A gradient (`g1`…`g6`), an uploaded image (its `/files/img/…` path or URL), or empty to remove it. */
	cover: Schema.optional(Schema.String),
	properties: PropertiesInput,
});

/** A cover as the page stores it, or why it can't be one. */
const coverOf = (value: string) => {
	const trimmed = value.trim();
	if (trimmed === "" || /^g[1-6]$/.test(trimmed)) return Effect.succeed(trimmed);
	// An uploaded image, as the API links it (`…/api/v1/files/img/x.png`) or the app stores it.
	const image = /(?:^|\/)(?:api\/v1\/)?files\/(img\/[\w.-]+)$/.exec(trimmed);
	if (image) return Effect.succeed(`/files/${image[1]}`);
	return Effect.fail(
		bad("A cover is g1 to g6 (gradients), an uploaded image (/files/img/…), or empty to remove it"),
	);
};

/** Stores a document through the editor's own save, which keeps search and backlinks in step. */
export const saveDoc = (id: string, state: unknown) =>
	Effect.gen(function* () {
		if (!state || typeof state !== "object" || !("root" in state))
			return yield* bad("`doc` must be the editor's state: {root: …}");
		yield* Pages.save(id, { doc: JSON.stringify(state) });
	});

/** Sets a row's properties, by name, one at a time through the table's own checks. */
const setProperties = Effect.fn("Api.setProperties")(function* (
	databaseId: string,
	rowId: string,
	properties: Record<string, unknown>,
) {
	for (const [name, value] of Object.entries(properties)) {
		const state = yield* databaseState(databaseId);
		if (!state) return yield* notFound("database");
		const column = yield* columnNamed(state, name);
		if (column.id === TITLE_COLUMN) {
			yield* Pages.rename(rowId, { title: String(value ?? "") });
			continue;
		}
		yield* runOp(rowId, {
			op: "setCell",
			databaseId,
			rowId,
			columnId: column.id,
			value: cellInput(column, value),
		}).pipe(
			Effect.catchTag("BadRequest", (error) =>
				Effect.fail(bad(`Property "${column.name}" (${column.type}): ${error.message}`)),
			),
		);
	}
});

/** Makes a page (in a folder) or a row (in a database), with its content. */
export const createPage = Effect.fn("Api.createPage")(function* (input: typeof NewPage.Type) {
	const now = yield* Clock.currentTimeMillis;
	const by = yield* Sessions.editor;
	let id: string;
	if (input.database) {
		if (!isId(input.database) || !(yield* databaseState(input.database)))
			return yield* notFound("database");
		const made = yield* runOp(input.database, {
			op: "addRow",
			databaseId: input.database,
			title: input.title ?? "",
		});
		id = (made as unknown as { rowId: string }).rowId;
	} else {
		const folders = yield* MainDb.folders.list();
		if (input.folder && !folders.some((f) => f.id === input.folder))
			return yield* notFound("folder");
		id = crypto.randomUUID();
		yield* MainDb.pages.create({
			id,
			folderId: input.folder ?? null,
			title: cleanTitle(input.title),
			now,
			by,
		});
	}
	const made = id;
	yield* Effect.gen(function* () {
		if (input.icon) yield* Pages.setIcon(made, { icon: input.icon });
		if (input.doc !== undefined) yield* saveDoc(made, input.doc);
		else if (input.markdown !== undefined) yield* saveDoc(made, fromMarkdown(input.markdown));
		if (input.properties) {
			if (!input.database) return yield* bad("Only database rows have properties");
			yield* setProperties(input.database, made, input.properties);
		}
	}).pipe(
		// A page that couldn't be made as asked isn't left half-made, to be made again on a retry.
		Effect.tapError(() => Effect.andThen(Trash.remove(made), Trash.purge([made]))),
	);
	return id;
});

/** Changes a page's title, icon, content or properties. */
export const updatePage = Effect.fn("Api.updatePage")(function* (
	id: string,
	input: typeof PageChanges.Type,
) {
	const page = yield* livePage(id);
	if (page.kind === "database" && (input.markdown ?? input.doc ?? input.append) !== undefined)
		return yield* bad("A database has rows, not content");
	if (input.title !== undefined) yield* Pages.rename(id, { title: input.title });
	if (input.icon !== undefined) yield* Pages.setIcon(id, { icon: input.icon });
	if (input.cover !== undefined) yield* Pages.setCover(id, { cover: yield* coverOf(input.cover) });
	if (input.doc !== undefined) yield* saveDoc(id, input.doc);
	else if (input.markdown !== undefined) yield* saveDoc(id, fromMarkdown(input.markdown));
	if (input.append !== undefined) yield* appendNodes(id, markdownBlocks(input.append));
	if (input.properties) {
		if (!page.database_id) return yield* bad("Only database rows have properties");
		yield* setProperties(page.database_id, id, input.properties);
	}
});

/** Adds blocks (the editor's nodes) to the end of a page's content. */
export const appendNodes = Effect.fn("Api.appendNodes")(function* (
	id: string,
	nodes: readonly unknown[],
) {
	const current = (parseJson((yield* livePage(id)).content) ?? fromMarkdown("")) as {
		root: { children?: unknown[] };
	};
	const children = (current.root.children ?? []).filter(
		(node, i, all) =>
			// A trailing empty paragraph is where the cursor waits; the new blocks go before it.
			!(i === all.length - 1 && isEmptyParagraph(node)),
	);
	yield* saveDoc(id, {
		...current,
		root: { ...current.root, children: [...children, ...nodes] },
	});
});

const isEmptyParagraph = (node: unknown) =>
	!!node &&
	typeof node === "object" &&
	(node as { type?: unknown }).type === "paragraph" &&
	((node as { children?: unknown[] }).children ?? []).length === 0;

/** To Trash, as the app does; it can be restored from there. */
export const trashPage = Effect.fn("Api.trashPage")(function* (id: string) {
	yield* livePage(id);
	yield* Trash.remove(id);
});

// ---------------------------------------------------------------- comments

export const pageComments = Effect.fn("Api.pageComments")(function* (id: string) {
	yield* livePage(id);
	return (yield* Comments.threads(id)).map((thread) => ({
		id: thread.id,
		quote: thread.quote,
		createdAt: iso(thread.createdAt),
		resolvedAt: iso(thread.resolvedAt),
		resolvedBy: thread.resolvedBy,
		comments: thread.comments.map((c) => ({
			id: c.id,
			author: c.author,
			body: c.body,
			createdAt: iso(c.createdAt),
			editedAt: iso(c.editedAt),
		})),
	}));
});

export const NewComment = Schema.Struct({
	body: Schema.String,
	/** A thread to reply to; a new comment on the whole page otherwise. */
	thread: Schema.optional(Schema.String),
	/** For a new thread: text of the page to comment on, which gets marked. */
	quote: Schema.optional(Schema.String),
});

export const addComment = Effect.fn("Api.addComment")(function* (
	id: string,
	input: typeof NewComment.Type,
) {
	const page = yield* livePage(id);
	if (input.thread) {
		if (input.quote)
			return yield* bad("A reply goes in its thread; only a new comment quotes text");
		yield* Comments.run(id, { op: "reply", thread: input.thread, body: input.body });
		return input.thread;
	}
	const thread = crypto.randomUUID();
	const quote = input.quote?.trim() ? input.quote : null;
	// The quoted text is found (and marked) before the thread is made, so a quote that
	// isn't there makes nothing.
	let marked: unknown = null;
	if (quote) {
		if (page.kind === "database") return yield* bad("A database has rows, not text to quote");
		const state = (parseJson(page.content) ?? fromMarkdown("")) as {
			root: { children?: unknown[] };
		};
		const blocks = structuredClone(state.root.children ?? []) as Parameters<typeof markQuote>[0];
		const problem = markQuote(blocks, quote, thread);
		if (problem) return yield* bad(problem);
		marked = { ...state, root: { ...state.root, children: blocks } };
	}
	yield* Comments.run(id, { op: "start", thread, quote, body: input.body });
	if (marked) yield* saveDoc(id, marked);
	return thread;
});

/** Resolves (or reopens) a thread, or edits or deletes one of the token owner's comments. */
export const changeComment = Effect.fn("Api.changeComment")(function* (
	id: string,
	change:
		| { op: "resolve"; thread: string; resolved: boolean }
		| { op: "edit"; comment: string; body: string }
		| { op: "delete"; comment: string },
) {
	yield* livePage(id);
	yield* Comments.run(id, change).pipe(
		Effect.catchTag("BadRequest", (error) =>
			Effect.fail(bad(COMMENT_PROBLEMS[error.message] ?? error.message)),
		),
	);
});

/** What the comments' error codes mean. */
const COMMENT_PROBLEMS: Record<string, string> = {
	empty_comment: "A comment can't be empty",
	comment_too_long: "A comment is at most 10,000 characters",
	invalid_thread: "That isn't a thread's id (see read_page)",
	invalid_comment: "That isn't a comment's id (see read_page)",
};
