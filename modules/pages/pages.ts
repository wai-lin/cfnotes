/** Pages: what one shows, and the edits made to it. */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, NotFound, PayloadTooLarge } from "spacefn";

import { Id } from "#lib/ids.ts";
import { cleanTitle } from "#lib/titles.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import { databaseState } from "#modules/database/database.ts";
import { plainText } from "#modules/search/text.ts";
import * as Sharing from "#modules/sharing/sharing.ts";
import * as Trash from "#modules/trash/trash.ts";
import MainDb from "#space/db/main.ts";

import { pageLinksIn } from "./links.ts";

/** Largest serialized editor state accepted on save (D1 rows max out at 2 MB). */
export const MAX_CONTENT_BYTES = 1_000_000;

/**
 * The save action's body limit. It is the document as a JSON string, so every
 * quote and backslash in it is escaped: up to twice the bytes, and the wrapper.
 */
export const SAVE_LIMITS = { maxBytes: 2 * MAX_CONTENT_BYTES + 1024 };

export const Params = Schema.Struct({ id: Id });
export const NewLinked = Schema.Struct({ title: Schema.optional(Schema.String) });
export const Title = Schema.Struct({ title: Schema.String });
export const Icon = Schema.Struct({ icon: Schema.String });
/** A preset id (`g1`…`g6`), an uploaded image's path, or empty to clear. */
export const Cover = Schema.Struct({
	cover: Schema.String.check(Schema.isPattern(/^(?:g[1-6]|\/files\/img\/[\w.-]+)?$/)),
});
export const Save = Schema.Struct({ doc: Schema.NonEmptyString });

const notFound = () => new NotFound({ message: "No such page" });

/** A page that isn't in Trash, or a 404. */
const live = Effect.fn("Pages.live")(function* (id: string) {
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page || page.archived_at !== null) return yield* notFound();
	return page;
});

/**
 * What the page shows, with what the reader may do on it, or `null` when it's
 * in Trash. A 404 for a page that isn't shared with them.
 */
export const view = Effect.fn("Pages.view")(function* (id: string) {
	const access = yield* Sharing.requireAccess(id, "view");
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page) return yield* notFound();
	if (page.archived_at !== null) return null;
	// Only the pages linking here that the reader may open.
	const backlinks = yield* Sharing.visible(yield* MainDb.links.listBacklinks({ id }));
	// A row links back to its database; a full-page database is drawn from its state.
	const parent = page.database_id
		? Option.getOrNull(yield* MainDb.databases.find({ id: page.database_id }))
		: null;
	const table = page.kind === "database" ? yield* databaseState(id) : null;
	return { page, backlinks, parent, table, access };
});

/** Where a page in Trash sends the reader: Trash for an owner, the workspace for a friend. */
export const goneTo = Effect.map(Sharing.me, (who) => (who?.owner ? "/trash" : "/"));

/** The editor's page picker: a new page next to this one (same folder). */
export const createLinked = Effect.fn("Pages.createLinked")(function* (
	from: string,
	input: typeof NewLinked.Type,
) {
	yield* Sharing.requireAccess(from, "edit");
	yield* live(from);
	const title = cleanTitle(input.title);
	const pages = yield* MainDb.pages.list();
	const folderId = pages.find((row) => row.id === from)?.folder_id ?? null;
	const id = crypto.randomUUID();
	yield* MainDb.pages.create({
		id,
		folderId,
		title,
		now: yield* Clock.currentTimeMillis,
		by: yield* Sessions.editor,
	});
	yield* Sharing.madeFrom(from, id);
	return { id, title };
});

/** The sidebar's link for a page, or `null`: rows and inline databases aren't in it. */
const navEntry = (page: {
	id: string;
	title: string;
	kind: string;
	icon: string | null;
	database_id: string | null;
	host_id: string | null;
}) => (page.database_id || page.host_id ? null : page);

export const rename = Effect.fn("Pages.rename")(function* (id: string, input: typeof Title.Type) {
	yield* Sharing.requireAccess(id, "edit");
	const page = yield* live(id);
	const title = cleanTitle(input.title);
	yield* MainDb.pages.updateTitle({
		id,
		title,
		now: yield* Clock.currentTimeMillis,
		by: yield* Sessions.editor,
	});
	return navEntry({ ...page, title });
});

export const setIcon = Effect.fn("Pages.setIcon")(function* (id: string, input: typeof Icon.Type) {
	yield* Sharing.requireAccess(id, "edit");
	const page = yield* live(id);
	const icon = input.icon.trim().slice(0, 32) || null;
	yield* MainDb.pages.setIcon({
		id,
		icon,
		now: yield* Clock.currentTimeMillis,
		by: yield* Sessions.editor,
	});
	return navEntry({ ...page, icon });
});

export const setCover = Effect.fn("Pages.setCover")(function* (
	id: string,
	input: typeof Cover.Type,
) {
	yield* Sharing.requireAccess(id, "edit");
	yield* live(id);
	const cover = input.cover || null;
	yield* MainDb.pages.setCover({
		id,
		cover,
		now: yield* Clock.currentTimeMillis,
		by: yield* Sessions.editor,
	});
	return cover;
});

/** Stores the serialized editor state, with the search text and backlinks that follow from it. */
export const save = Effect.fn("Pages.save")(function* (id: string, { doc }: typeof Save.Type) {
	yield* Sharing.requireAccess(id, "edit");
	yield* live(id);
	if (new TextEncoder().encode(doc).byteLength > MAX_CONTENT_BYTES)
		return yield* new PayloadTooLarge({ limitBytes: MAX_CONTENT_BYTES });
	const invalid = () => new BadRequest({ message: "That isn't a document" });
	const state = yield* Effect.try({ try: () => JSON.parse(doc) as unknown, catch: invalid });
	if (!state || typeof state !== "object" || !("root" in state)) return yield* invalid();

	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.pages.updateContent({
		id,
		content: doc,
		bodyText: plainText(state),
		now,
		by: yield* Sessions.editor,
	});
	yield* MainDb.links.clear({ id });
	const links = pageLinksIn(state, id);
	if (links.length > 0) yield* MainDb.links.add({ id, ids: JSON.stringify(links) });
});

/** To Trash, then where to go: its database, host page or the workspace, which offers Undo. */
export const remove = Effect.fn("Pages.remove")(function* (id: string) {
	yield* Sharing.requireOwner;
	const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
	if (!page || page.archived_at !== null) return "/";
	yield* Trash.remove(id);
	const back = page.database_id ?? page.host_id;
	const query = new URLSearchParams({ trashed: id, title: page.title });
	return `${back ? `/p/${back}` : "/"}?${query}`;
});
