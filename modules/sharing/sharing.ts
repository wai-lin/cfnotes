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

import { atLeast, folderRoles, ROLES, roleOfRank, sharedTree, type Access } from "./roles.ts";

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

/** What the signed-in person may do in each folder; folders they can't see are left out. */
export const folderAccessAll = Effect.gen(function* () {
	const who = yield* me;
	const out = new Map<string, Access>();
	if (!who) return out;
	const folders = yield* MainDb.folders.list();
	if (who.owner) {
		for (const folder of folders) out.set(folder.id, "owner");
		return out;
	}
	const shares = yield* MainDb.shares.listFor({ email: normalize(who.email) });
	return folderRoles(shares, folders) as Map<string, Access>;
});

/**
 * What the signed-in person may do in folder `id` (`null` is the top level,
 * an owner's alone), failing unless it's at least `min`. A 404 for a folder
 * they can't see.
 */
export const requireFolder = Effect.fn("Sharing.requireFolder")(function* (
	id: string | null,
	min: Access = "edit",
) {
	if (id === null) {
		if ((yield* me)?.owner) return "owner" as Access;
		return yield* new Forbidden({ message: "Only the workspace's owners add to the top level" });
	}
	const access = (yield* folderAccessAll).get(id) ?? null;
	if (access === null) return yield* new NotFound({ message: "No such folder" });
	if (!atLeast(access, min))
		return yield* new Forbidden({ message: "You can't change what's in that folder" });
	return access;
});

/** Where a page lives: its database, the page holding it, or its folder (`null`, the top level). */
type Home = { database_id: string | null; host_id: string | null; folder_id: string | null };

/**
 * Fails unless the signed-in person may change where `page` lives: move it
 * out, or put it in Trash. That's an edit of its database, host page or folder,
 * so a page shared with a friend on its own stays put.
 */
export const requireHome = Effect.fn("Sharing.requireHome")(function* (page: Home) {
	const holder = page.database_id ?? page.host_id;
	if (holder) {
		const access = yield* accessTo(holder);
		if (!atLeast(access, "edit"))
			return yield* new Forbidden({ message: "You can't remove what's in there" });
		return;
	}
	yield* requireFolder(page.folder_id, "edit").pipe(
		Effect.catchTag("NotFound", () =>
			Effect.fail(new Forbidden({ message: "Only the workspace's owners can move or delete it" })),
		),
	);
});

/** Whether the signed-in person may move or trash `page` (see `requireHome`). */
export const mayRehome = (page: Home) =>
	Effect.match(requireHome(page), { onFailure: () => false, onSuccess: () => true });

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
	if (!who || who.owner) return { ...all, guest: false, editable: [] as string[] };
	const email = normalize(who.email);
	const shares = yield* MainDb.shares.listFor({ email });
	const tree = sharedTree({
		shares,
		folders: all.folders,
		pages: all.pages,
		direct: yield* MainDb.shares.listPages({ email }),
	});
	// The folders they may add to, rename and reorder.
	const editable = [...folderRoles(shares, all.folders)]
		.filter(([, role]) => role === "edit")
		.map(([id]) => id);
	return { ...tree, index: yield* visible(all.index), guest: true, editable };
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
