/**
 * A database's views, for the MCP server: their layout, filters, sorts and
 * grouping, by property name. Each change goes through the table's own view
 * ops, which keep only what's valid; anything an agent asks for that wouldn't
 * survive that is refused here, with the reason.
 */
import { Effect, Schema } from "effect";
import { BadRequest } from "spacefn";

import type { DatabaseState } from "#modules/database/columns.ts";
import { runOp } from "#modules/database/database.ts";
import {
	cleanView,
	groupsBy,
	LAYOUTS,
	MAX_VIEWS,
	placesBy,
	type Sort,
	type View,
} from "#modules/database/view.ts";

import { columnNamed, describeView, liveDatabase, whereFilters } from "./api.ts";

const bad = (message: string) => new BadRequest({ message });

/** What a view may be set to; unset fields stay as they are. */
export const ViewSettings = Schema.Struct({
	name: Schema.optional(Schema.String),
	layout: Schema.optional(Schema.Literals(LAYOUTS)),
	/** Filters as `query_database`'s `where`; they replace the view's. */
	where: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
	/** `["-Date", "Name"]`; replaces the view's sorts. */
	sort: Schema.optional(Schema.Array(Schema.String)),
	/** Board lanes (a select), or a table's or list's groups; `null` stops grouping. */
	group_by: Schema.optional(Schema.NullOr(Schema.String)),
	/** Calendar and timeline: the date property that places rows. */
	date_by: Schema.optional(Schema.NullOr(Schema.String)),
	/** Timeline: the date property where a row's bar ends. */
	end_by: Schema.optional(Schema.NullOr(Schema.String)),
	/** Table: show row numbers. */
	row_numbers: Schema.optional(Schema.Boolean),
});
type ViewSettings = typeof ViewSettings.Type;

/** A database the caller may change the views of: an edit of it. */
const state = (id: string) => liveDatabase(id, "edit");

/** The view called `name` (or with that id), or a 400 naming the ones there are. */
const viewNamed = (db: DatabaseState, name: string) => {
	const found =
		db.views.find((v) => v.id === name) ??
		db.views.find((v) => v.name.toLowerCase() === name.trim().toLowerCase());
	return found
		? Effect.succeed(found)
		: Effect.fail(
				bad(`No view "${name}": there are ${db.views.map((v) => `"${v.name}"`).join(", ")}`),
			);
};

/** `view` with `settings` applied, checked as the table would keep it. */
const settle = Effect.fn("Views.settle")(function* (
	db: DatabaseState,
	view: View,
	settings: ViewSettings,
) {
	const next: View = { ...view };
	if (settings.name !== undefined) next.name = settings.name;
	if (settings.layout !== undefined) next.layout = settings.layout;
	if (settings.where !== undefined) next.filters = yield* whereFilters(db, settings.where);
	if (settings.sort !== undefined) {
		const sorts: Sort[] = [];
		for (const entry of settings.sort) {
			const desc = entry.startsWith("-");
			const column = yield* columnNamed(db, desc ? entry.slice(1) : entry);
			sorts.push({ columnId: column.id, direction: desc ? "desc" : "asc" });
		}
		next.sorts = sorts;
	}
	const property = Effect.fnUntraced(function* (
		key: "groupBy" | "dateBy" | "endBy",
		value: string | null | undefined,
	) {
		if (value === undefined) return;
		if (value === null) delete next[key];
		else next[key] = (yield* columnNamed(db, value)).id;
	});
	yield* property("groupBy", settings.group_by);
	yield* property("dateBy", settings.date_by);
	yield* property("endBy", settings.end_by);
	if (settings.row_numbers !== undefined) next.rowNumbers = settings.row_numbers;

	const byId = new Map(db.columns.map((c) => [c.id, c]));
	// A new layout drops what it doesn't use, and picks what it needs, unless asked otherwise.
	if (settings.layout !== undefined && settings.layout !== view.layout) {
		if (settings.group_by === undefined && !groupsBy(next.layout, byId.get(next.groupBy ?? "")))
			delete next.groupBy;
		if (next.layout === "board" && settings.group_by === undefined && !next.groupBy) {
			const select = db.columns.find((c) => groupsBy("board", c));
			if (select) next.groupBy = select.id;
		}
		const dated = next.layout === "calendar" || next.layout === "timeline";
		if (!dated) {
			if (settings.date_by === undefined) delete next.dateBy;
			if (settings.end_by === undefined) delete next.endBy;
		} else if (settings.date_by === undefined && !next.dateBy) {
			const date = db.columns.find((c) => placesBy(c));
			if (date) next.dateBy = date.id;
		}
		if (next.layout !== "timeline" && settings.end_by === undefined) delete next.endBy;
		if (next.layout !== "table" && settings.row_numbers === undefined) delete next.rowNumbers;
	}

	// What the table would quietly drop is a mistake to say out loud.
	const named = (id: string | undefined) => `"${byId.get(id ?? "")?.name ?? id}"`;
	if (next.groupBy && !groupsBy(next.layout, byId.get(next.groupBy)))
		return yield* bad(
			next.layout === "board"
				? `A board groups by a select; ${named(next.groupBy)} isn't one`
				: next.layout === "table" || next.layout === "list"
					? `A ${next.layout} can't group by ${named(next.groupBy)}`
					: `A ${next.layout} doesn't group`,
		);
	for (const key of ["dateBy", "endBy"] as const) {
		if (!next[key]) continue;
		if (next.layout !== "calendar" && next.layout !== "timeline")
			return yield* bad(`Only a calendar or timeline is placed by a date`);
		if (key === "endBy" && next.layout !== "timeline")
			return yield* bad(`Only a timeline has an end date`);
		if (!placesBy(byId.get(next[key])))
			return yield* bad(`${named(next[key])} isn't a date, so it can't place rows`);
	}
	if (settings.row_numbers !== undefined && next.layout !== "table")
		return yield* bad("Only a table shows row numbers");
	if (!next.name.trim()) return yield* bad("A view needs a name");
	const clean = cleanView(next, db.columns);
	if (clean.filters.length !== next.filters.length)
		return yield* bad("A view holds at most 20 filters");
	return clean;
});

const run = (databaseId: string, body: Record<string, unknown>) =>
	runOp(databaseId, { databaseId, ...body } as Parameters<typeof runOp>[1]);

/** Adds a view, set up as `settings` says; answers with it. */
export const createView = Effect.fn("Views.create")(function* (databaseId: string, input: unknown) {
	const settings = yield* Schema.decodeUnknownEffect(ViewSettings)(input);
	const db = yield* state(databaseId);
	if (db.views.length >= MAX_VIEWS) return yield* bad(`A database has at most ${MAX_VIEWS} views`);
	// Checked before anything is made, so a mistake leaves nothing behind.
	const draft: View = {
		id: "new",
		name: "",
		layout: settings.layout ?? "table",
		sorts: [],
		filters: [],
	};
	yield* settle(db, draft, { name: "New", ...settings });
	const made = (yield* run(databaseId, { op: "addView", layout: draft.layout })) as {
		viewId?: string;
	};
	const after = yield* state(databaseId);
	const view = after.views.find((v) => v.id === made.viewId)!;
	// A new board or calendar picks its own grouping and dates; asked-for ones win.
	const next = yield* settle(after, view, settings);
	yield* run(databaseId, { op: "setView", view: next });
	return describeView(after, next);
});

/** Changes a view's settings; answers with it. */
export const updateView = Effect.fn("Views.update")(function* (
	databaseId: string,
	name: string,
	input: unknown,
) {
	const settings = yield* Schema.decodeUnknownEffect(ViewSettings)(input);
	const db = yield* state(databaseId);
	const view = yield* viewNamed(db, name);
	const next = yield* settle(db, view, settings);
	yield* run(databaseId, { op: "setView", view: next });
	return describeView(db, next);
});

/** Deletes a view; a database keeps at least one. */
export const deleteView = Effect.fn("Views.delete")(function* (databaseId: string, name: string) {
	const db = yield* state(databaseId);
	const view = yield* viewNamed(db, name);
	if (db.views.length < 2) return yield* bad("A database keeps at least one view");
	yield* run(databaseId, { op: "deleteView", viewId: view.id });
});
