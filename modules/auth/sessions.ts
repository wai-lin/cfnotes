/** Cookie sessions, in the `sessions` table. */
import { Clock, Effect, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { redirect, sessionAuth } from "spacefn";

import Env from "#configs/env.ts";
import MainDb from "#space/db/main.ts";

import { emails, isAllowed, normalize } from "./access.ts";
import * as Tokens from "./tokens.ts";

export const COOKIE = "session";

const DAY = 24 * 60 * 60 * 1000;
const ABSOLUTE = 30 * DAY;
const IDLE = 7 * DAY;

/** Whether `email` owns the workspace: it's on ALLOWED_EMAILS. */
export const isOwner = (email: string) =>
	Effect.map(Env, (env) => isAllowed(env.ALLOWED_EMAILS, email));

/** Whether `email` may sign in: an owner, or someone with a page or folder shared with them. */
export const mayEnter = Effect.fn("Sessions.mayEnter")(function* (email: string) {
	if (yield* isOwner(email)) return true;
	const found = yield* MainDb.hasShare({ email: normalize(email) });
	return Option.match(found, { onNone: () => false, onSome: (row) => row.shared === 1 });
});

/** Whether `email` may edit something shared with them (so upload files for it). */
export const editsSomething = Effect.fn("Sessions.editsSomething")(function* (email: string) {
	if (yield* isOwner(email)) return true;
	const found = yield* MainDb.hasShare({ email: normalize(email) });
	return Option.match(found, { onNone: () => false, onSome: (row) => row.edits === 1 });
});

const sessions = (secure: boolean) =>
	sessionAuth({
		cookie: COOKIE,
		secure,
		policy: { absolute: ABSOLUTE, idle: IDLE },
		lookup: (tokenHash) =>
			Effect.gen(function* () {
				const row = Option.getOrUndefined(yield* MainDb.findSession({ tokenHash }));
				// Checked on every request, so taking someone off the list, or their last share, signs them out.
				if (!row || !(yield* mayEnter(row.email))) return Option.none();
				return Option.some({
					user: { email: row.email },
					expiresAt: row.expires_at,
					lastSeenAt: row.last_seen_at,
				});
			}),
		touch: (tokenHash, now) => MainDb.touchSession({ tokenHash, now }),
	});

// Two fixed ones, as each caches the user per request. Safari drops Secure cookies on http://localhost.
const overHttps = sessions(true);
const onLocalhost = sessions(false);

/** Whether cookies are Secure: everywhere but on http://localhost. */
export const secureCookies = Effect.map(Env, (env) => env.ORIGIN.startsWith("https:"));

const auth = Effect.map(secureCookies, (secure) => (secure ? overHttps : onLocalhost));

/**
 * Who is signed in, if anyone. On the API that's whoever made the request's
 * token, and a session cookie counts for nothing there.
 */
export const user = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	if (Tokens.isApiPath(request.url.split("?")[0]!))
		return Option.map(yield* Tokens.caller, (it) => ({ email: it.email }));
	return yield* (yield* auth).user;
});

/** The signed-in email, to record who changed something; `null` when no one is. */
export const editor = Effect.map(user, (found) =>
	Option.match(found, { onNone: () => null, onSome: (it) => it.email }),
);

/** Everyone who may sign in: the choices for a Person property. */
export const people = Effect.map(Env, (env) => emails(env.ALLOWED_EMAILS));

/** Who is signed in, or a 401. */
export const requireUser = Effect.flatMap(auth, (it) => it.requireUser);

/** Ends the request's session, if it has one. */
const end = Effect.gen(function* () {
	const tokenHash = yield* (yield* auth).currentTokenHash;
	if (tokenHash) yield* MainDb.deleteSession({ tokenHash });
});

/** Starts a session for `email`, replacing the browser's old one, and goes to `to`. */
export const start = Effect.fn("Sessions.start")(function* (email: string, to: string) {
	const it = yield* auth;
	yield* end;
	const { token, tokenHash, expiresAt } = yield* it.create;
	// A hash is only missing for a token that isn't one of ours.
	if (!tokenHash) return yield* Effect.die(new Error("A new session token didn't hash"));
	yield* MainDb.createSession({ tokenHash, email, expiresAt, now: yield* Clock.currentTimeMillis });
	return it.signIn(redirect(to), token);
});

export const signOut = Effect.gen(function* () {
	yield* end;
	return (yield* auth).signOut(redirect("/login"));
});

/** The daily job: sessions that no longer sign anyone in. */
export const purgeJob = Effect.gen(function* () {
	const now = yield* Clock.currentTimeMillis;
	yield* MainDb.deleteExpiredSessions({ now, idleSince: now - IDLE });
});
