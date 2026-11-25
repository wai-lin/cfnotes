/**
 * Signing in without Google, for local development: only while ORIGIN is
 * http://localhost and the request itself comes to localhost, so a deploy
 * (ORIGIN is https there) never offers it. It takes any email that may sign
 * in, so what a friend sees of a share can be tried too.
 */
import { Effect, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { Input, NotFound, redirect } from "spacefn";

import Env from "#configs/env.ts";

import { emails, returnPath } from "./access.ts";
import * as Sessions from "./sessions.ts";

export const PATH = "/auth/dev";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** Whether this request may sign in without Google. */
export const enabled = Effect.gen(function* () {
	const env = yield* Env;
	if (!env.ORIGIN.startsWith("http://localhost")) return false;
	const request = yield* HttpServerRequest.HttpServerRequest;
	// A Web request keeps its whole URL here; otherwise only the Host header says.
	const url = URL.parse(request.originalUrl);
	return LOCAL_HOST.test(url?.host || request.headers["host"] || "");
});

/** What the sign-in page offers, or `null` when it's off: the owners, to pick from. */
export const offer = Effect.gen(function* () {
	if (!(yield* enabled)) return null;
	return { path: PATH, emails: emails((yield* Env).ALLOWED_EMAILS) };
});

const Form = Schema.Struct({ email: Schema.String, next: Schema.optional(Schema.String) });

export const signIn = Effect.gen(function* () {
	// As if it weren't there at all.
	if (!(yield* enabled)) return yield* new NotFound({ message: "Not found" });
	const { email, next } = yield* Input.body(Form);
	const who = email.trim();
	if (!who || !(yield* Sessions.mayEnter(who))) return redirect("/login?error=not-allowed");
	yield* Effect.logInfo(`Dev sign-in as ${who}`);
	return yield* Sessions.start(who, returnPath(next));
});
