/** MCP tools for databases: describing, querying, making them and changing their properties. */
import { Effect, Schema } from "effect";
import { BadRequest } from "spacefn";

import { COLORS, COLUMN_TYPES } from "#modules/database/columns.ts";
import { LAYOUTS } from "#modules/database/view.ts";

import * as Api from "../api.ts";
import * as DbSchema from "../schema.ts";
import * as Views from "../table-views.ts";
import {
	adds,
	array,
	boolean,
	changes,
	databaseId,
	enumOf,
	object,
	readOnly,
	record,
	str,
	string,
	type Json,
	type Tool,
} from "./tool.ts";

/** Types an agent can add (the automatic ones fill themselves in). */
const TYPES = COLUMN_TYPES;
const color = enumOf(COLORS, "The option's colour.");
const options = array(
	{
		anyOf: [{ type: "string" }, object({ name: string("The option."), color }, ["name"])],
	},
	'A select\'s or multi-select\'s choices: names, or {"name", "color"}.',
);
const relation = object(
	{
		database_id: string("The database it links to (this one's own id links rows to each other)."),
		two_way: boolean("Also add a property there that links back."),
	},
	["database_id"],
);
const rollup = object(
	{
		relation: string("A relation property of this database."),
		property: string("A property of the related rows (their title if unset)."),
		function: enumOf(DbSchema.ROLLUP_FUNCTIONS, "What to work out (show_original if unset)."),
	},
	["relation"],
);
const script = string(
	'A script property\'s TypeScript, a function body: `return row["Price"] * row["Qty"];`. `row` has this row\'s properties by name, `rows` every row, `db.related("Relation")` the linked rows; sum, avg, min, max, count and round are there.',
);
const propertyFields: Json = {
	name: string("The property's name."),
	type: enumOf(TYPES, "Its type."),
	options,
	relation,
	rollup,
	script,
};
const property = object(propertyFields, ["name", "type"]);

const where: Json = {
	type: "object",
	description: [
		"Property name → a value (equality; containment for multi-select, people and relations; a checkbox takes true or false), or an object of operators that must all hold.",
		"Text, URL, email, phone, files, rollups, scripts: contains, not_contains, is, is_not, starts_with, ends_with.",
		"Number: eq, neq, gt, lt, gte, lte. Date, date & time (by its day), time, created/edited time: is, before, after, on_or_before, on_or_after, as YYYY-MM-DD (HH:MM for a time).",
		"Select: is, is_not. Multi-select, people, relations (by title): contains, not_contains. Checkbox: checked, unchecked.",
		'Every type: empty, not_empty ({"empty": true}).',
	].join(" "),
	additionalProperties: {
		anyOf: [
			{ type: ["string", "number", "boolean"] },
			{ type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
		],
	},
};

/** One change's schema: its action, and what that action takes. */
const change = (action: string, description: string, fields: Json, required: string[]) => ({
	...object({ action: { const: action }, ...fields }, ["action", ...required]),
	description,
});
const named = { property: string("The property, by name.") };

const schemaChange = {
	oneOf: [
		change(
			"add_property",
			"Adds a property (relation, rollup and script need their settings).",
			{ ...propertyFields, before: string("Put it before this property; last if unset.") },
			["name", "type"],
		),
		change("rename_property", "Renames a property.", { ...named, name: string("Its new name.") }, [
			"property",
			"name",
		]),
		change(
			"change_type",
			"Converts a property to another type, keeping what values carry over.",
			{ ...named, type: enumOf(TYPES, "The new type.") },
			["property", "type"],
		),
		change(
			"move_property",
			"Moves a property.",
			{
				...named,
				before: { type: ["string", "null"], description: "Before this property; null for last." },
			},
			["property", "before"],
		),
		change("delete_property", "Deletes a property and its values.", named, ["property"]),
		change(
			"add_option",
			"Adds a choice to a select or multi-select.",
			{ ...named, option: string("The new option."), color },
			["property", "option"],
		),
		change(
			"update_option",
			"Renames or recolours a choice; rows keep it.",
			{ ...named, option: string("The option, by name."), name: string("Its new name."), color },
			["property", "option"],
		),
		change(
			"delete_option",
			"Deletes a choice; rows that had it are left empty there.",
			{ ...named, option: string("The option, by name.") },
			["property", "option"],
		),
		change(
			"set_rollup",
			"Changes what a rollup works out.",
			{
				...named,
				relation: string("A relation property of this database."),
				target: string("A property of the related rows."),
				function: enumOf(DbSchema.ROLLUP_FUNCTIONS, "What to work out."),
			},
			["property", "relation"],
		),
		change("set_script", "Replaces a script property's code.", { ...named, script }, [
			"property",
			"script",
		]),
	],
};

/** A view's settings, for create_view and update_view. */
const viewFields = (): Json => ({
	name: string("The view's name."),
	layout: enumOf(LAYOUTS, "How it shows the rows."),
	where: {
		...where,
		description: `Its filters, replacing any it has: ${String(where.description)}`,
	},
	sort: array(
		{ type: "string" },
		'Its sorts, replacing any it has: property names, "-Name" for descending.',
	),
	group_by: {
		type: ["string", "null"],
		description:
			"A board's lanes (a select property), or the property a table or list groups rows by (select, multi-select, checkbox, person, date); null stops grouping.",
	},
	date_by: {
		type: ["string", "null"],
		description: "Calendar and timeline: the date property that places rows.",
	},
	end_by: {
		type: ["string", "null"],
		description: "Timeline: the date property where a row's bar ends.",
	},
	row_numbers: boolean("Table: show each row's number."),
});

/** At most this many rows in one create_rows or update_rows. */
const MAX_BATCH = 100;

/** A failure as the agent reads it in a batch's answer. */
const why = (error: unknown) => {
	const { _tag, message } = (error ?? {}) as { _tag?: unknown; message?: unknown };
	return typeof _tag === "string" && typeof message === "string"
		? `${_tag}: ${message}`
		: "Something went wrong";
};

/**
 * Runs `each` on every item, one after another: what worked, and what failed
 * and why (a failure doesn't stop the rest). Unexpected failures still fail.
 */
const batch = <A, B>(
	items: readonly A[],
	each: (item: A, index: number) => Effect.Effect<B, unknown, any>,
) =>
	Effect.gen(function* () {
		if (items.length === 0) return yield* new BadRequest({ message: "No rows" });
		if (items.length > MAX_BATCH)
			return yield* new BadRequest({ message: `At most ${MAX_BATCH} rows at a time` });
		const done: B[] = [];
		const failed: { index: number; error: string }[] = [];
		for (const [index, item] of items.entries()) {
			const result = yield* Effect.result(each(item, index));
			if (result._tag === "Success") done.push(result.success);
			else {
				const tag = (result.failure as { _tag?: unknown })?._tag;
				if (!["BadRequest", "NotFound", "SchemaError", "Conflict"].includes(String(tag)))
					return yield* Effect.fail(result.failure);
				failed.push({ index, error: why(result.failure) });
			}
		}
		return { done, failed };
	});

const rowsOf = (value: unknown) => (Array.isArray(value) ? (value as unknown[]) : []);

export const DATABASE_TOOLS: Tool[] = [
	{
		name: "list_databases",
		title: "List databases",
		description: "Lists the databases, with their ids.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Api.listDatabases, (databases) => ({ databases })),
	},
	{
		name: "get_database",
		title: "Describe a database",
		description:
			"A database's properties (name, type, a select's options, what a relation links to, a rollup's settings, a script's code), its views and its number of rows.",
		inputSchema: object({ database_id: databaseId }, ["database_id"]),
		annotations: readOnly,
		run: (args) => Api.getDatabase(str(args.database_id) ?? ""),
	},
	{
		name: "query_database",
		title: "Query a database",
		description:
			'Lists a database\'s rows with their properties, filtered, sorted and paged. Filter with "where": {"Status": "Published"} for equality, or operators: {"Date": {"on_or_after": "2026-11-01"}, "Views": {"gt": 100}, "Tags": {"empty": true}, "Title": {"contains": "draft"}}. get_database\'s property types say which operators apply.',
		inputSchema: object(
			{
				database_id: databaseId,
				where,
				where_any: array(
					where,
					"Groups like where; a row must match at least one of them (and where too). For OR.",
				),
				sort: {
					type: "array",
					items: { type: "string" },
					description: 'Property names; "-Name" sorts descending.',
				},
				view: string("Start from a view's own filters and sorts (its name or id)."),
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 1000,
					description: "At most this many rows (100 if unset).",
				},
				offset: { type: "integer", minimum: 0 },
				include_content: { type: "boolean", description: "Also each row's content, as Markdown." },
			},
			["database_id"],
		),
		annotations: readOnly,
		run: (args) =>
			Effect.gen(function* () {
				const query = yield* Schema.decodeUnknownEffect(Api.RowsQuery)({
					where: record(args.where),
					whereAny: Array.isArray(args.where_any) ? args.where_any : undefined,
					sort: Array.isArray(args.sort) ? args.sort.map(String) : undefined,
					view: str(args.view),
					limit: typeof args.limit === "number" ? args.limit : undefined,
					offset: typeof args.offset === "number" ? args.offset : undefined,
					content: args.include_content === true ? "markdown" : undefined,
					pageUrl: "/p/{id}",
				});
				return yield* Api.queryRows(str(args.database_id) ?? "", query);
			}),
	},
	{
		name: "create_database",
		title: "Create a database",
		description:
			"Makes a database with its properties and no rows: full-page (at the top level or in a folder), or inline at the end of a page. Every database has a title property, Name. Add rows with create_page. Answers with the database as get_database does.",
		inputSchema: object(
			{
				title: string("The database's title."),
				folder_id: string("A folder for a full-page database (see list_folders)."),
				page_id: string("A page to put it in, inline, at the end of its content."),
				icon: string("An emoji."),
				properties: array(property, "Its properties besides Name, in order."),
			},
			["title"],
		),
		annotations: adds,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = yield* DbSchema.createDatabase(args);
				return yield* Api.getDatabase(id);
			}),
	},
	{
		name: "update_database",
		title: "Change a database",
		description:
			"Renames a database and changes its properties: adds, renames, converts, moves and deletes them, edits a select's options, and sets rollups and scripts. Changes run in order and stop at the first that fails (the ones before it stay made). Answers with the database as it is now.",
		inputSchema: object(
			{
				database_id: databaseId,
				title: string("A new title."),
				changes: array(schemaChange, "What to change, in order."),
			},
			["database_id"],
		),
		annotations: changes,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.database_id) ?? "";
				yield* DbSchema.updateDatabase(id, { title: args.title, changes: args.changes });
				return yield* Api.getDatabase(id);
			}),
	},
	{
		name: "create_view",
		title: "Add a view",
		description:
			"Adds a view to a database: a table, board, list, gallery, calendar or timeline, with its own filters, sorts and grouping. A board groups by its first select and a calendar by its first date unless told otherwise. Answers with the view.",
		inputSchema: object({ database_id: databaseId, ...viewFields() }, ["database_id", "layout"]),
		annotations: adds,
		write: true,
		run: (args) => {
			const { database_id, ...settings } = args;
			return Views.createView(str(database_id) ?? "", settings);
		},
	},
	{
		name: "update_view",
		title: "Change a view",
		description:
			"Changes a view's name, layout, filters, sorts or grouping; what's left out stays. Switching layout drops what the new one doesn't use. Answers with the view.",
		inputSchema: object(
			{ database_id: databaseId, view: string("The view, by name or id."), ...viewFields() },
			["database_id", "view"],
		),
		annotations: changes,
		write: true,
		run: (args) => {
			const { database_id, view, ...settings } = args;
			return Views.updateView(str(database_id) ?? "", str(view) ?? "", settings);
		},
	},
	{
		name: "delete_view",
		title: "Delete a view",
		description:
			"Deletes one of a database's views (not its rows). A database keeps at least one view.",
		inputSchema: object({ database_id: databaseId, view: string("The view, by name or id.") }, [
			"database_id",
			"view",
		]),
		annotations: { ...changes, idempotentHint: true },
		write: true,
		run: (args) =>
			Effect.as(
				Views.deleteView(str(args.database_id) ?? "", str(args.view) ?? ""),
				"Deleted the view.",
			),
	},
	{
		name: "create_rows",
		title: "Add rows",
		description: `Adds up to ${MAX_BATCH} rows to a database in one go, each with its title, properties and optionally Markdown content. A row that fails doesn't stop the others: the answer lists what was made ("created", with ids) and what failed and why ("failed", by index).`,
		inputSchema: object(
			{
				database_id: databaseId,
				rows: array(
					object(
						{
							title: string("The row's title."),
							properties: {
								type: "object",
								description: 'By name, e.g. {"Status": "Draft"}.',
								additionalProperties: true,
							},
							markdown: string("The row page's content, as Markdown."),
							icon: string("An emoji."),
						},
						["title"],
					),
					"The rows, in order.",
				),
			},
			["database_id", "rows"],
		),
		annotations: adds,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const database = str(args.database_id) ?? "";
				// A database that isn't there fails the whole call, not each row.
				yield* Api.getDatabase(database);
				const { done, failed } = yield* batch(rowsOf(args.rows), (row) => {
					const r = record(row) ?? {};
					return Effect.map(
						Api.createPage({
							database,
							title: str(r.title),
							markdown: str(r.markdown),
							icon: str(r.icon),
							properties: record(r.properties),
						}),
						(id) => ({ id, title: str(r.title) ?? "" }),
					);
				});
				return { created: done, failed };
			}),
	},
	{
		name: "update_rows",
		title: "Change rows",
		description: `Changes up to ${MAX_BATCH} rows (of any databases) in one go: their titles, icons and properties. A row that fails doesn't stop the others: the answer lists the ids changed ("updated") and what failed and why ("failed", by index).`,
		inputSchema: object(
			{
				rows: array(
					object(
						{
							page_id: string("The row's id."),
							title: string("A new title."),
							properties: {
								type: "object",
								description: "Properties to set, by name; others stay.",
								additionalProperties: true,
							},
							icon: string("An emoji; empty to remove it."),
						},
						["page_id"],
					),
					"The rows and their changes.",
				),
			},
			["rows"],
		),
		annotations: changes,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const { done, failed } = yield* batch(rowsOf(args.rows), (row) => {
					const r = record(row) ?? {};
					const id = str(r.page_id) ?? "";
					return Effect.as(
						Api.updatePage(id, {
							title: str(r.title),
							icon: str(r.icon),
							properties: record(r.properties),
						}),
						id,
					);
				});
				return { updated: done, failed };
			}),
	},
];
