/**
 * How much a friend's tokens may use the API and the MCP server, together:
 * plenty for an agent's day of work, not enough to flood the workspace.
 * Owners aren't limited.
 */
import { Effect, Option } from "effect";
import { rateLimit } from "spacefn";

import { normalize } from "#modules/auth/access.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Tokens from "#modules/auth/tokens.ts";

/** Requests, across all of a friend's tokens. */
export const FRIEND_LIMITS = { perMinute: 60, perDay: 2000 };

/**
 * Counts one request by the request's token, failing with `TooManyRequests`
 * past a friend's limits. When the counter itself can't be reached, the
 * request goes through (and that's logged) rather than locking them out.
 */
export const countCall = Effect.gen(function* () {
	const caller = Option.getOrUndefined(yield* Tokens.caller);
	if (!caller || (yield* Sessions.isOwner(caller.email))) return;
	const who = normalize(caller.email);
	yield* rateLimit(`api-minute:${who}`, { limit: FRIEND_LIMITS.perMinute, window: "1 minute" });
	yield* rateLimit(`api-day:${who}`, { limit: FRIEND_LIMITS.perDay, window: "1 day" });
}).pipe(
	Effect.catchTag("RateLimiterError", (error) =>
		Effect.logWarning("The API's rate limiter failed; letting the request through", error),
	),
);

/** What an agent is told past the limit. */
export const limitText = (retryAfterSeconds: number | undefined) =>
	`Too many requests: a friend's tokens make up to ${FRIEND_LIMITS.perMinute} a minute and ${FRIEND_LIMITS.perDay} a day.` +
	(retryAfterSeconds === undefined ? "" : ` Try again in ${retryAfterSeconds} seconds.`);
