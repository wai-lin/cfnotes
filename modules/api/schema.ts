/**
 * Making databases and changing their properties, for the MCP server: each
 * change goes through the table's own ops (`runOp`), so an agent gets the same
 * checks as the table UI. Properties and options are named, never by id.
 */
import { Effect, Schema } from "effect";
import { BadRequest, NotFound } from "spacefn";

import { isId } from "#lib/ids.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import {
	COLORS,
	COLUMN_TYPES,
	type Column,
	type DatabaseState,
	type SelectOption,
} from "#modules/database/columns.ts";
import { databaseState, newDatabase, runOp } from "#modules/database/database.ts";
import { fnsFor, isRollupFn, ROLLUP_FNS } from "#modules/database/rollup.ts";
import { compileScript } from "#modules/database/script/compile.ts";
import * as Pages from "#modules/pages/pages.ts";
import MainDb from "#space/db/main.ts";

import { appendNodes, columnNamed, livePage } from "./api.ts";

const bad = (message: string) => new BadRequest({ message });

/** What the table's error codes mean, for an agent. */
const PROBLEMS: Record<string, string> = {
	invalid_type: `unknown type; one of ${COLUMN_TYPES.join(", ")}`,
	invalid_name: "a name can't be empty",
	invalid_target: "no such database to relate to",
	needs_relation: "a rollup needs a relation property first",
	too_many_columns: "a database has at most 50 properties",
	title_column: "the title property can't be changed that way",
	relation_type: "a relation is added and deleted, not converted to or from",
	rollup_type: "a rollup is added and deleted, not converted to or from",
	script_type: "a script is added and deleted, not converted to or from",
	invalid_option: "no such option",
	invalid_before: "no such property to put it before",
	invalid_script: "the script didn't compile",
	invalid_column: "that property can't be changed that way",
};

const Color = Schema.Literals(COLORS);
const OptionSpec = Schema.Union([
	Schema.String,
	Schema.Struct({ name: Schema.String, color: Schema.optional(Color) }),
]);

/** A new property: its name and type, and what its type needs. */
export const PropertySpec = Schema.Struct({
	name: Schema.String,
	type: Schema.Literals(COLUMN_TYPES),
	/** A select's or multi-select's choices. */
	options: Schema.optional(Schema.Array(OptionSpec)),
	/** A relation's other database, and whether it gets a property back to this one. */
	relation: Schema.optional(
		Schema.Struct({ database_id: Schema.String, two_way: Schema.optional(Schema.Boolean) }),
	),
	/** A rollup: a relation property here, a property of the related rows, and a calculation. */
	rollup: Schema.optional(
		Schema.Struct({
			relation: Schema.String,
			property: Schema.optional(Schema.String),
			function: Schema.optional(Schema.String),
		}),
	),
	/** A script's TypeScript (a function body: `return row["Price"] * 2;`). */
	script: Schema.optional(Schema.String),
});

const Named = { property: Schema.String };

/** One change to a database's properties. */
export const SchemaChange = Schema.Union([
	Schema.Struct({
		action: Schema.Literal("add_property"),
		...PropertySpec.fields,
		/** Where it goes: before this property; last otherwise. */
		before: Schema.optional(Schema.String),
	}),
	Schema.Struct({ action: Schema.Literal("rename_property"), ...Named, name: Schema.String }),
	Schema.Struct({
		action: Schema.Literal("change_type"),
		...Named,
		type: Schema.Literals(COLUMN_TYPES),
	}),
	Schema.Struct({
		action: Schema.Literal("move_property"),
		...Named,
		before: Schema.NullOr(Schema.String),
	}),
	Schema.Struct({ action: Schema.Literal("delete_property"), ...Named }),
	Schema.Struct({
		action: Schema.Literal("add_option"),
		...Named,
		option: Schema.String,
		color: Schema.optional(Color),
	}),
	Schema.Struct({
		action: Schema.Literal("update_option"),
		...Named,
		option: Schema.String,
		name: Schema.optional(Schema.String),
		color: Schema.optional(Color),
	}),
	Schema.Struct({ action: Schema.Literal("delete_option"), ...Named, option: Schema.String }),
	Schema.Struct({
		action: Schema.Literal("set_rollup"),
		...Named,
		relation: Schema.String,
		target: Schema.optional(Schema.String),
		function: Schema.optional(Schema.String),
	}),
	Schema.Struct({ action: Schema.Literal("set_script"), ...Named, script: Schema.String }),
]);
export type SchemaChange = typeof SchemaChange.Type;

const DatabaseChanges = Schema.Struct({
	title: Schema.optional(Schema.String),
	changes: Schema.optional(Schema.Array(SchemaChange)),
});

const NewDatabase = Schema.Struct({
	title: Schema.optional(Schema.String),
	/** A folder for a full-page database. */
	folder_id: Schema.optional(Schema.String),
	/** A page to put it in, as an inline database at the end of its content. */
	page_id: Schema.optional(Schema.String),
	icon: Schema.optional(Schema.String),
	/** Properties besides the title (Name), which every database has. */
	properties: Schema.optional(Schema.Array(PropertySpec)),
});

const optionNamed = (column: Column, name: string): SelectOption | undefined =>
	column.options?.find((o) => o.name === name) ??
	column.options?.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());

/** One table op, its error code said in words. */
const op = (databaseId: string, body: Record<string, unknown>, what: string) =>
	runOp(databaseId, { databaseId, ...body } as Parameters<typeof runOp>[1]).pipe(
		Effect.catchTag("BadRequest", (error) =>
			Effect.fail(bad(`${what}: ${PROBLEMS[error.message] ?? error.message}`)),
		),
	);

const fresh = Effect.fn("Schema.fresh")(function* (id: string) {
	const state = yield* databaseState(id);
	if (!state) return yield* new NotFound({ message: "No such database" });
	return state;
});

/** A rollup's settings by name, as the table stores them (by id), checked here so mistakes say so. */
const rollupConfig = Effect.fn("Schema.rollupConfig")(function* (
	state: DatabaseState,
	spec: { relation: string; property?: string | undefined; function?: string | undefined },
) {
	const relation = yield* columnNamed(state, spec.relation);
	if (relation.type !== "relation" || !relation.relation)
		return yield* bad(`"${relation.name}" isn't a relation`);
	const target = yield* fresh(relation.relation.databaseId);
	const column = spec.property ? yield* columnNamed(target, spec.property) : target.columns[0]!;
	if (column.type === "rollup") return yield* bad("A rollup can't roll up another rollup");
	const fn = spec.function ?? "show_original";
	const allowed = fnsFor(column.type);
	if (!isRollupFn(fn) || !allowed.includes(fn))
		return yield* bad(
			`Function "${fn}" doesn't work on ${column.type}; one of ${allowed.join(", ")}`,
		);
	return { relationId: relation.id, targetId: column.id, fn };
});

/** A script's source compiled as the editor does; a mistake in it is an error here, not a broken property. */
const script = (source: string) => {
	const config = compileScript(source);
	return config.error
		? Effect.fail(bad(`The script doesn't compile: ${config.error}`))
		: Effect.succeed(config);
};

/** Adds one property, and its options. */
const addProperty = Effect.fn("Schema.addProperty")(function* (
	id: string,
	spec: typeof PropertySpec.Type & { before?: string | undefined },
) {
	const what = `Adding "${spec.name}"`;
	const state = yield* fresh(id);
	const extra: Record<string, unknown> = {};
	if (spec.type === "relation") {
		if (!spec.relation) return yield* bad(`${what}: a relation needs relation.database_id`);
		if (!isId(spec.relation.database_id)) return yield* bad(`${what}: no such database`);
		extra.relation = { databaseId: spec.relation.database_id, twoWay: spec.relation.two_way };
	}
	if (spec.type === "rollup") {
		if (!spec.rollup) return yield* bad(`${what}: a rollup needs rollup.relation`);
		extra.rollup = yield* rollupConfig(state, spec.rollup);
	}
	if (spec.type === "script") extra.script = yield* script(spec.script ?? "return null;");
	const made = yield* op(id, { op: "addColumn", type: spec.type, name: spec.name, ...extra }, what);
	const columnId = (made as { columnId?: string }).columnId!;
	for (const option of spec.options ?? []) {
		const { name, color } =
			typeof option === "string" ? { name: option, color: undefined } : option;
		yield* addOption(id, columnId, name, color);
	}
	if (spec.before !== undefined) {
		const before = yield* columnNamed(yield* fresh(id), spec.before);
		yield* op(id, { op: "moveColumn", columnId, beforeId: before.id }, what);
	}
});

const addOption = Effect.fn("Schema.addOption")(function* (
	id: string,
	columnId: string,
	name: string,
	color?: string,
) {
	const what = `Adding option "${name}"`;
	yield* op(id, { op: "addOption", columnId, name }, what);
	if (!color) return;
	const column = (yield* fresh(id)).columns.find((c) => c.id === columnId)!;
	const option = optionNamed(column, name);
	if (option) yield* op(id, { op: "updateOption", columnId, optionId: option.id, color }, what);
});

/** Applies one change. */
const apply = Effect.fn("Schema.apply")(function* (id: string, change: SchemaChange) {
	if (change.action === "add_property") return yield* addProperty(id, change);
	const state = yield* fresh(id);
	const column = yield* columnNamed(state, change.property);
	const what = `${change.action} "${column.name}"`;
	const columnId = column.id;
	const option = () => {
		if (!("option" in change)) return Effect.die("no option");
		const found = optionNamed(column, change.option);
		if (!column.options) return Effect.fail(bad(`${what}: "${column.name}" has no options`));
		return found
			? Effect.succeed(found)
			: Effect.fail(
					bad(
						`${what}: no option "${change.option}"; there are ${column.options.map((o) => `"${o.name}"`).join(", ") || "none"}`,
					),
				);
	};
	switch (change.action) {
		case "rename_property":
			return yield* op(id, { op: "renameColumn", columnId, name: change.name }, what);
		case "change_type":
			return yield* op(id, { op: "setColumnType", columnId, type: change.type }, what);
		case "move_property": {
			const before = change.before === null ? null : (yield* columnNamed(state, change.before)).id;
			return yield* op(id, { op: "moveColumn", columnId, beforeId: before }, what);
		}
		case "delete_property":
			return yield* op(id, { op: "deleteColumn", columnId }, what);
		case "add_option":
			if (!column.options) return yield* bad(`${what}: "${column.name}" has no options`);
			return yield* addOption(id, columnId, change.option, change.color);
		case "update_option": {
			const found = yield* option();
			return yield* op(
				id,
				{
					op: "updateOption",
					columnId,
					optionId: found.id,
					name: change.name,
					color: change.color,
				},
				what,
			);
		}
		case "delete_option":
			return yield* op(id, { op: "deleteOption", columnId, optionId: (yield* option()).id }, what);
		case "set_rollup":
			if (column.type !== "rollup") return yield* bad(`${what}: "${column.name}" isn't a rollup`);
			return yield* op(
				id,
				{
					op: "setRollup",
					columnId,
					rollup: yield* rollupConfig(state, {
						relation: change.relation,
						property: change.target,
						function: change.function,
					}),
				},
				what,
			);
		case "set_script":
			if (column.type !== "script") return yield* bad(`${what}: "${column.name}" isn't a script`);
			return yield* op(
				id,
				{ op: "setScript", columnId, script: yield* script(change.script) },
				what,
			);
	}
});

/** A database's title and properties changed, in order; the first change that fails stops the rest. */
export const updateDatabase = Effect.fn("Schema.updateDatabase")(function* (
	id: string,
	input: unknown,
) {
	const changes = yield* Schema.decodeUnknownEffect(DatabaseChanges)(input);
	if (!isId(id)) return yield* new NotFound({ message: "No such database" });
	yield* fresh(id);
	if (changes.title !== undefined)
		yield* op(id, { op: "rename", title: changes.title }, "Renaming");
	for (const [i, change] of (changes.changes ?? []).entries())
		yield* apply(id, change).pipe(
			Effect.catchTag("BadRequest", (error) =>
				Effect.fail(
					bad(
						`Change ${i + 1} of ${changes.changes!.length}: ${error.message}${i > 0 ? ` (changes before it were made)` : ""}`,
					),
				),
			),
		);
});

/** A database, full-page (top level or in a folder) or inline at the end of a page, with no rows yet. */
export const createDatabase = Effect.fn("Schema.createDatabase")(function* (input: unknown) {
	const spec = yield* Schema.decodeUnknownEffect(NewDatabase)(input);
	if (spec.folder_id && spec.page_id) return yield* bad("Give folder_id or page_id, not both");
	if (spec.folder_id && !(yield* MainDb.folders.list()).some((f) => f.id === spec.folder_id))
		return yield* new NotFound({ message: "No such folder" });
	const host = spec.page_id ? yield* livePage(spec.page_id) : null;
	if (host && (host.kind === "database" || host.database_id))
		return yield* bad("An inline database goes in a page, not a database or its rows");
	const id = yield* newDatabase({
		folderId: spec.folder_id ?? null,
		hostId: host?.id ?? null,
		title: spec.title ?? "",
		by: yield* Sessions.editor,
		rows: 0,
	});
	if (host) yield* appendNodes(host.id, [{ type: "database", version: 1, databaseId: id }]);
	if (spec.icon) yield* Pages.setIcon(id, { icon: spec.icon });
	for (const [i, property] of (spec.properties ?? []).entries())
		yield* addProperty(id, property).pipe(
			Effect.catchTag("BadRequest", (error) =>
				Effect.fail(bad(`Made database ${id}, but property ${i + 1} failed: ${error.message}`)),
			),
		);
	return id;
});

/** For the tools' descriptions: the calculations a rollup can do. */
export const ROLLUP_FUNCTIONS = Object.keys(ROLLUP_FNS);
