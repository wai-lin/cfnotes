/**
 * API tokens: `Authorization: Bearer cfn_…` on `/api/…`, acting as the person
 * who made the token: an owner, or a friend, who reaches only what's shared
 * with them. Only a hash is stored, and the token is shown once.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { BadRequest, Forbidden, NotFound } from "spacefn";

import Env from "#configs/env.ts";
import { isId } from "#lib/ids.ts";
import MainDb from "#space/db/main.ts";

import { isAllowed, normalize } from "./access.ts";

export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];

/** Who a request's token acts for, and what it may do. */
export interface Caller {
	email: string;
	scope: Scope;
}

const PREFIX = "cfn_";
const MAX_NAME = 80;
/** How many tokens a friend may have at once; owners may have any number. */
export const MAX_FRIEND_TOKENS = 3;
/** `last_used_at` is written at most this often per token. */
const TOUCH_EVERY = 60_000;

export const New = Schema.Struct({
	name: Schema.String,
	scope: Schema.Literals(SCOPES),
});
export const Revoke = Schema.Struct({ id: Schema.String });

/** Whether `path` is the API's, where tokens work (and cookies don't). */
export const isApiPath = (path: string) => path === "/api" || path.startsWith("/api/");

const hex = (bytes: ArrayBuffer) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The stored form of a token. */
export const hashToken = (token: string) =>
	Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).pipe(
		Effect.map(hex),
	);

/** A new token: `cfn_` and 32 random bytes, base64url. */
const newToken = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const base64 = btoa(String.fromCharCode(...bytes));
	return PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The bearer token a request carries, if it looks like one of ours. */
const bearerOf = (request: HttpServerRequest.HttpServerRequest) => {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers["authorization"] ?? "");
	const token = match?.[1];
	return token?.startsWith(PREFIX) ? token : null;
};

// Looked up once per request: a request asks who it's from more than once.
const seen = new WeakMap<object, Option.Option<Caller>>();

/** Whether `email` may still sign in: an owner, or someone with something shared with them. */
const mayEnter = Effect.fn("Tokens.mayEnter")(function* (email: string) {
	if (isAllowed((yield* Env).ALLOWED_EMAILS, email)) return true;
	const found = yield* MainDb.shares.has({ email: normalize(email) });
	return Option.match(found, { onNone: () => false, onSome: (row) => row.shared === 1 });
});

/** Who the request's token acts for: none without a valid token, or once its maker can't sign in. */
export const caller = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const cached = seen.get(request);
	if (cached) return cached;
	const token = bearerOf(request);
	let found: Option.Option<Caller> = Option.none();
	if (token) {
		const row = Option.getOrUndefined(
			yield* MainDb.tokens.find({ tokenHash: yield* hashToken(token) }),
		);
		if (row && (yield* mayEnter(row.created_by))) {
			const now = yield* Clock.currentTimeMillis;
			if (row.last_used_at === null || now - row.last_used_at > TOUCH_EVERY)
				yield* MainDb.tokens.touch({ id: row.id, now });
			found = Option.some({
				email: row.created_by,
				scope: row.scope === "write" ? "write" : "read",
			});
		}
	}
	seen.set(request, found);
	return found;
});

/** Fails unless the request's token may make changes. */
export const requireWrite = Effect.gen(function* () {
	const found = yield* caller;
	if (Option.isNone(found) || found.value.scope !== "write")
		return yield* new Forbidden({ message: "This token can only read" });
});

export interface TokenInfo {
	id: string;
	name: string;
	scope: Scope;
	createdAt: number;
	createdBy: string;
	lastUsedAt: number | null;
}

/** Who's managing tokens: an owner sees and revokes every one, a friend only their own. */
export interface Manager {
	email: string;
	owner: boolean;
}

const isTheirs = (who: Manager, createdBy: string) =>
	who.owner || normalize(createdBy) === normalize(who.email);

export const list = (who: Manager) =>
	Effect.map(MainDb.tokens.list(), (rows) =>
		rows
			.filter((row) => isTheirs(who, row.created_by))
			.map((row): TokenInfo => ({
				id: row.id,
				name: row.name,
				scope: row.scope === "write" ? "write" : "read",
				createdAt: row.created_at,
				createdBy: row.created_by,
				lastUsedAt: row.last_used_at,
			})),
	);

/** Makes a token for `who`; the answer holds the only copy of it. */
export const create = Effect.fn("Tokens.create")(function* (
	input: typeof New.Type,
	who: Manager | null,
) {
	if (!who) return yield* new Forbidden({ message: "Sign in first" });
	const by = who.email;
	if (!who.owner && (yield* list(who)).length >= MAX_FRIEND_TOKENS)
		return yield* new BadRequest({
			message: `You can have ${MAX_FRIEND_TOKENS} tokens: revoke one to make another`,
		});
	const name = input.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
	if (!name) return yield* new BadRequest({ message: "A token needs a name" });
	const token = newToken();
	yield* MainDb.tokens.create({
		id: crypto.randomUUID(),
		name,
		tokenHash: yield* hashToken(token),
		scope: input.scope,
		now: yield* Clock.currentTimeMillis,
		by,
	});
	return { name, scope: input.scope, token };
});

/** Revokes a token: an owner any (to stop a leaked one), a friend their own. */
export const revoke = Effect.fn("Tokens.revoke")(function* (
	{ id }: typeof Revoke.Type,
	who: Manager | null,
) {
	if (!isId(id) || !who) return yield* new NotFound({ message: "No such token" });
	if (!(yield* list(who)).some((token) => token.id === id))
		return yield* new NotFound({ message: "No such token" });
	yield* MainDb.tokens.delete({ id });
});
