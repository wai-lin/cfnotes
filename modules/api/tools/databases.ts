/** MCP tools for databases: describing, querying, making them and changing their properties. */
import { Effect, Schema } from "effect";

import { COLORS, COLUMN_TYPES } from "#modules/database/columns.ts";

import * as Api from "../api.ts";
import * as DbSchema from "../schema.ts";
import {
	adds,
	array,
	boolean,
	changes,
	databaseId,
	enumOf,
	json,
	object,
	readOnly,
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

export const DATABASE_TOOLS: Tool[] = [
	{
		name: "list_databases",
		title: "List databases",
		description: "Lists the databases, with their ids.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Api.listDatabases, json),
	},
	{
		name: "get_database",
		title: "Describe a database",
		description:
			"A database's properties (name, type, a select's options, what a relation links to, a rollup's settings, a script's code), its views and its number of rows.",
		inputSchema: object({ database_id: databaseId }, ["database_id"]),
		annotations: readOnly,
		run: (args) => Effect.map(Api.getDatabase(str(args.database_id) ?? ""), json),
	},
	{
		name: "query_database",
		title: "Query a database",
		description: "Lists a database's rows with their properties, filtered, sorted and paged.",
		inputSchema: object(
			{
				database_id: databaseId,
				where: {
					type: "object",
					description:
						'Property name → value. Keeps rows whose property is the value (contains it, for multi-select, people and relations). Checkboxes: "true" or "false".',
					additionalProperties: { type: "string" },
				},
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
				const where =
					args.where && typeof args.where === "object"
						? (args.where as Record<string, unknown>)
						: {};
				const query = yield* Schema.decodeUnknownEffect(Api.RowsQuery)({
					where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, String(v)])),
					sort: Array.isArray(args.sort) ? args.sort.map(String) : undefined,
					view: str(args.view),
					limit: typeof args.limit === "number" ? args.limit : undefined,
					offset: typeof args.offset === "number" ? args.offset : undefined,
					content: args.include_content === true ? "markdown" : undefined,
					pageUrl: "/p/{id}",
				});
				return json(yield* Api.queryRows(str(args.database_id) ?? "", query));
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
				return json(yield* Api.getDatabase(id));
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
				return json(yield* Api.getDatabase(id));
			}),
	},
];
