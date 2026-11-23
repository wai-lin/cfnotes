/** The sign-in page's data. */
import { Effect, Option, Schema } from "effect";
import { Input, redirect } from "spacefn";

import Env from "#configs/env.ts";

import { returnPath } from "./access.ts";
import { PATH } from "./google.ts";
import * as Sessions from "./sessions.ts";

const Query = Schema.Struct({
	next: Schema.optional(Schema.String),
	error: Schema.optional(Schema.String),
});

export const load = Effect.gen(function* () {
	const { next, error } = yield* Input.query(Query);
	const to = returnPath(next);
	if (Option.isSome(yield* Sessions.user)) return redirect(to);
	// Absolute, so the state cookie is set on the host Google comes back to.
	const href = new URL(PATH, (yield* Env).ORIGIN);
	if (to !== "/") href.searchParams.set("next", to);
	return { href: href.toString(), error };
});
