/**
 * Synced blocks: one block's content, shown in every page that holds a block
 * with its id. Pages keep their own copy in their content too (for search,
 * backlinks and a first paint without waiting); this is the latest one.
 */
import { Clock, Effect, Schema } from "effect";
import { BadRequest } from "spacefn";

import { isId } from "#lib/ids.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Sharing from "#modules/sharing/sharing.ts";
import MainDb from "#space/db/main.ts";

/** Largest content accepted, as JSON (a page holds at most 1 MB in all). */
export const MAX_SYNCED_BYTES = 500_000;
/** Most blocks one request asks for. */
const MAX_IDS = 100;

/** The action's body limit: content travels as JSON inside JSON. */
export const SYNCED_LIMITS = { maxBytes: MAX_SYNCED_BYTES + 4096 };

/** `get`: the latest content of `ids`. `save`: replace one block's content. */
export const Op = Schema.Struct({
	op: Schema.Literals(["get", "save"]),
	ids: Schema.optional(Schema.Array(Schema.String)),
	id: Schema.optional(Schema.String),
	content: Schema.optional(Schema.Unknown),
});

const bad = (message: string) => new BadRequest({ message });

/**
 * Runs one op from page `pageId`; `get` answers `{blocks: {id: content}}` (a
 * missing id isn't saved yet). Reading takes a reader of the page, saving an editor.
 */
export const run = Effect.fn("Synced.run")(function* (pageId: string, body: typeof Op.Type) {
	yield* Sharing.requireAccess(pageId, body.op === "get" ? "view" : "edit");
	if (body.op === "get") {
		const ids = [...new Set(body.ids ?? [])];
		if (ids.length > MAX_IDS || !ids.every(isId)) return yield* bad("invalid_ids");
		const found =
			ids.length > 0 ? yield* MainDb.findSyncedBlocks({ ids: JSON.stringify(ids) }) : [];
		const blocks: Record<string, unknown> = {};
		for (const row of found) blocks[row.id] = JSON.parse(row.content) as unknown;
		return { blocks };
	}
	if (!isId(body.id)) return yield* bad("invalid_id");
	// Children of a Lexical element: an array of serialized nodes, each with a type.
	const content = body.content;
	if (
		!Array.isArray(content) ||
		!content.every(
			(n) => !!n && typeof n === "object" && typeof (n as { type?: unknown }).type === "string",
		)
	)
		return yield* bad("invalid_content");
	const json = JSON.stringify(content);
	if (new TextEncoder().encode(json).byteLength > MAX_SYNCED_BYTES) return yield* bad("too_large");
	yield* MainDb.saveSyncedBlock({
		id: body.id,
		content: json,
		now: yield* Clock.currentTimeMillis,
		by: yield* Sessions.editor,
	});
	return { ok: true };
});
