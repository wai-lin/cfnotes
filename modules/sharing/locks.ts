/**
 * Locks: an owner locks a page, database or folder so that the people it's
 * shared with can't change it, or anything in it, until it's unlocked. They
 * may still read it and comment. The rule itself is in the access checks
 * (`page-roles.sql` and `folderRoles`); this is turning it on and off.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { NotFound } from "spacefn";

import { Id } from "#lib/ids.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import MainDb from "#space/db/main.ts";

import { folderLock, requireOwner } from "./sharing.ts";

export const Lock = Schema.Struct({
	kind: Schema.Literals(["page", "folder"]),
	id: Id,
	locked: Schema.Boolean,
});

/** What locks page `id`, nearest first (itself, what holds it, a folder above), or `null`. */
export const lockOf = (id: string) =>
	Effect.map(MainDb.pages.findLock({ id }), (found) => Option.getOrNull(found));

/** Locks or unlocks a page (a database with its rows) or a folder (with everything in it). Owners only. */
export const setLock = Effect.fn("Locks.setLock")(function* ({
	kind,
	id,
	locked,
}: typeof Lock.Type) {
	yield* requireOwner;
	const at = locked ? yield* Clock.currentTimeMillis : null;
	const by = locked ? yield* Sessions.editor : null;
	if (kind === "page") {
		const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
		if (!page || page.archived_at !== null) return yield* new NotFound({ message: "No such page" });
		yield* MainDb.pages.setLock({ id, at, by });
	} else {
		if (!(yield* MainDb.folders.list()).some((folder) => folder.id === id))
			return yield* new NotFound({ message: "No such folder" });
		yield* MainDb.folders.setLock({ id, at, by });
	}
});

/** Whether folder `id` is locked, by itself or a folder above it. */
export const folderLocked = Effect.fn("Locks.folderLocked")(function* (id: string) {
	return folderLock(yield* MainDb.folders.list(), id) !== null;
});
