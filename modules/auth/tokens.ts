/**
 * API tokens: `Authorization: Bearer cfn_…` on `/api/…`, acting as the person
 * who made the token. Only a hash is stored, and the token is shown once.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { BadRequest, Forbidden, NotFound } from "spacefn";

import Env from "#configs/env.ts";
import { isId } from "#lib/ids.ts";
import MainDb from "#space/db/main.ts";

import { isAllowed } from "./access.ts";

export const SCOPES = ["read", "write"] as const;
export type Scope = (typeof SCOPES)[number];

/** Who a request's token acts for, and what it may do. */
export interface Caller {
	email: string;
	scope: Scope;
}

const PREFIX = "cfn_";
const MAX_NAME = 80;
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

/** Who the request's token acts for: none without a valid token, or once its maker can't sign in. */
export const caller = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	const cached = seen.get(request);
	if (cached) return cached;
	const token = bearerOf(request);
	let found: Option.Option<Caller> = Option.none();
	if (token) {
		const row = Option.getOrUndefined(
			yield* MainDb.findApiToken({ tokenHash: yield* hashToken(token) }),
		);
		const { ALLOWED_EMAILS } = yield* Env;
		if (row && isAllowed(ALLOWED_EMAILS, row.created_by)) {
			const now = yield* Clock.currentTimeMillis;
			if (row.last_used_at === null || now - row.last_used_at > TOUCH_EVERY)
				yield* MainDb.touchApiToken({ id: row.id, now });
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

export const list = Effect.map(MainDb.listApiTokens(), (rows) =>
	rows.map((row): TokenInfo => ({
		id: row.id,
		name: row.name,
		scope: row.scope === "write" ? "write" : "read",
		createdAt: row.created_at,
		createdBy: row.created_by,
		lastUsedAt: row.last_used_at,
	})),
);

/** Makes a token for `by`; the answer holds the only copy of it. */
export const create = Effect.fn("Tokens.create")(function* (
	input: typeof New.Type,
	by: string | null,
) {
	if (!by) return yield* new Forbidden({ message: "Sign in first" });
	const name = input.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
	if (!name) return yield* new BadRequest({ message: "A token needs a name" });
	const token = newToken();
	yield* MainDb.createApiToken({
		id: crypto.randomUUID(),
		name,
		tokenHash: yield* hashToken(token),
		scope: input.scope,
		now: yield* Clock.currentTimeMillis,
		by,
	});
	return { name, scope: input.scope, token };
});

/** Revokes a token: anyone signed in may, as anyone may need to stop a leaked one. */
export const revoke = Effect.fn("Tokens.revoke")(function* ({ id }: typeof Revoke.Type) {
	if (!isId(id)) return yield* new NotFound({ message: "No such token" });
	yield* MainDb.deleteApiToken({ id });
});
