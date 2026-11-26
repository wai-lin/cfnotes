/**
 * Sharing pages and folders with people outside ALLOWED_EMAILS (friends), as
 * viewers, commenters or editors, and what the signed-in person may do on a
 * page. Owners (ALLOWED_EMAILS) may do anything; everyone else only what's
 * shared with them. A share covers a page's rows and inline databases, and a
 * folder's pages and subfolders.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, Forbidden, NotFound } from "spacefn";

import { Id } from "#lib/ids.ts";
import { normalize } from "#modules/auth/access.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import MainDb from "#space/db/main.ts";

import { atLeast, ROLES, roleOfRank, sharedTree, type Access } from "./roles.ts";

/** Who is signed in, and whether they own the workspace; `null` when no one is. */
export const me = Effect.gen(function* () {
	const user = yield* Sessions.user;
	if (Option.isNone(user)) return null;
	const { email } = user.value;
	return { email, owner: yield* Sessions.isOwner(email) };
});

/** What the signed-in person may do on each of `ids`; pages they can't see are left out. */
export const accessToAll = Effect.fn("Sharing.accessToAll")(function* (ids: readonly string[]) {
	const out = new Map<string, Access>();
	const who = yield* me;
	if (!who || ids.length === 0) return out;
	if (who.owner) {
		for (const id of ids) out.set(id, "owner");
		return out;
	}
	const rows = yield* MainDb.shares.pageRoles({
		ids: JSON.stringify([...new Set(ids)]),
		email: normalize(who.email),
	});
	for (const row of rows) out.set(row.id, roleOfRank(row.rank));
	return out;
});

/** What the signed-in person may do on page `id`, or `null`. */
export const accessTo = (id: string) =>
	Effect.map(accessToAll([id]), (found) => found.get(id) ?? null);

const DENIED: Record<Access, string> = {
	view: "That page isn't shared with you",
	comment: "You can only view this page",
	edit: "You can't edit this page",
	owner: "Only the workspace's owners can do that",
};

/**
 * What the signed-in person may do on page `id`, failing unless it's at least
 * `min`. A 404 when they can't see it at all, so it doesn't say it exists.
 */
export const requireAccess = Effect.fn("Sharing.requireAccess")(function* (
	id: string,
	min: Access,
) {
	const access = yield* accessTo(id);
	if (access === null) return yield* new NotFound({ message: "No such page" });
	if (!atLeast(access, min)) return yield* new Forbidden({ message: DENIED[min] });
	return access;
});

/** Fails unless an owner is signed in. */
export const requireOwner = Effect.gen(function* () {
	if (!(yield* me)?.owner) return yield* new Forbidden({ message: DENIED.owner });
});

/** The ones of `items` the signed-in person may see (`min` or more). */
export const visible = <T extends { id: string }>(items: readonly T[], min: Access = "view") =>
	Effect.map(accessToAll(items.map((item) => item.id)), (access) =>
		items.filter((item) => atLeast(access.get(item.id), min)),
	);

/**
 * A page made from page `fromId` (from its `[[` picker) is shared with the same
 * people, and a friend who made it may edit it, wherever it lands.
 */
export const madeFrom = Effect.fn("Sharing.madeFrom")(function* (fromId: string, toId: string) {
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.shares.copyPage({ fromId, toId, now });
	const who = yield* me;
	if (!who || who.owner || atLeast(yield* accessTo(toId), "edit")) return;
	yield* MainDb.shares.put({
		kind: "page",
		id: toId,
		email: normalize(who.email),
		role: "edit",
		now,
		by: who.email,
	});
});

/** The sidebar, and the titles of pages outside it, as the signed-in person may see them. */
export const workspace = Effect.gen(function* () {
	const who = yield* me;
	const all = yield* Effect.all({
		pages: MainDb.pages.list(),
		folders: MainDb.folders.list(),
		index: MainDb.pages.listIndex(),
	});
	if (!who || who.owner) return { ...all, guest: false };
	const email = normalize(who.email);
	const tree = sharedTree({
		shares: yield* MainDb.shares.listFor({ email }),
		folders: all.folders,
		pages: all.pages,
		direct: yield* MainDb.shares.listPages({ email }),
	});
	return { ...tree, index: yield* visible(all.index), guest: true };
});

/** Where `/` takes a friend: the first page in their sidebar, or `null` while nothing's shared. */
export const firstShared = Effect.gen(function* () {
	const { pages, folders } = yield* workspace;
	// Top-level pages, then those in folders, as the sidebar lists them.
	const top = pages.find((page) => page.folder_id === null);
	return (top ?? pages.find((page) => folders.some((f) => f.id === page.folder_id)))?.id ?? null;
});

// ---- the Share dialog (owners only) ----

const EMAIL = /^[^\s,@<>"]+@[^\s,@<>"]+\.[^\s,@<>"]+$/;

/**
 * `list` who a page or folder is shared with, `invite` someone (or change
 * their role), `setRole` or `remove` them. Every op answers with the list.
 */
export const Op = Schema.Struct({
	op: Schema.Literals(["list", "invite", "setRole", "remove"]),
	kind: Schema.Literals(["page", "folder"]),
	id: Id,
	email: Schema.optional(Schema.String),
	role: Schema.optional(Schema.Literals(ROLES)),
});

export interface Person {
	email: string;
	role: (typeof ROLES)[number];
	createdAt: number;
}

const bad = (message: string) => new BadRequest({ message });

export const run = Effect.fn("Sharing.run")(function* (body: typeof Op.Type) {
	yield* requireOwner;
	const { kind, id } = body;
	if (kind === "page") {
		const page = Option.getOrUndefined(yield* MainDb.pages.find({ id }));
		if (!page || page.archived_at !== null) return yield* new NotFound({ message: "No such page" });
	} else if (!(yield* MainDb.folders.list()).some((folder) => folder.id === id))
		return yield* new NotFound({ message: "No such folder" });

	const shares = () => MainDb.shares.list({ kind, id });
	const email = normalize((body.email ?? "").trim());
	if (body.op !== "list") {
		if (email.length > 254 || !EMAIL.test(email)) return yield* bad("invalid_email");
	}
	switch (body.op) {
		case "list":
			break;
		case "invite":
		case "setRole": {
			if (yield* Sessions.isOwner(email)) return yield* bad("already_owner");
			if (body.op === "setRole" && !(yield* shares()).some((row) => row.email === email))
				return yield* new NotFound({ message: "Not shared with them" });
			yield* MainDb.shares.put({
				kind,
				id,
				email,
				role: body.role ?? "view",
				now: yield* Clock.currentTimeMillis,
				by: yield* Sessions.editor,
			});
			break;
		}
		case "remove":
			yield* MainDb.shares.delete({ kind, id, email });
			break;
	}
	const people: Person[] = (yield* shares()).map((row) => ({
		email: row.email,
		role: ROLES.find((role) => role === row.role) ?? "view",
		createdAt: row.created_at,
	}));
	return { people };
});
