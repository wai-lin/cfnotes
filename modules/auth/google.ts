/** Sign in with Google: the code flow with PKCE, for the emails in ALLOWED_EMAILS. */
import { Duration, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { OAuth, OAuthError, redirect } from "spacefn";

import Env from "#configs/env.ts";

import { isAllowed, returnPath } from "./access.ts";
import * as Sessions from "./sessions.ts";
import type { Problem } from "./views.ts";

export const PATH = "/auth/google";
/** Remembers the page to go back to while the browser is at Google. */
const RETURN_COOKIE = "return_to";

const PROBLEMS: Record<OAuthError["reason"], Problem> = {
	denied: "cancelled",
	state: "expired",
	exchange: "failed",
	profile: "failed",
};

const failed = (problem: Problem) => redirect(`/login?error=${problem}`);

/** Sends the browser to Google or, on its way back, signs it in. */
export const signIn = Effect.gen(function* () {
	const env = yield* Env;
	const secure = yield* Sessions.secureCookies;
	const google = OAuth.google({
		clientId: env.GOOGLE_CLIENT_ID,
		clientSecret: env.GOOGLE_CLIENT_SECRET,
		redirectUri: `${env.ORIGIN}${PATH}`,
		secure,
	});
	const request = yield* HttpServerRequest.HttpServerRequest;
	const cookie = { path: PATH, httpOnly: true, secure, sameSite: "lax" } as const;

	if (!(yield* google.isCallback)) {
		const started = yield* google.start;
		// Without it Google reuses the last account, so a refused one could never pick another.
		const chooser = new URL(started.headers["location"]!);
		chooser.searchParams.set("prompt", "select_account");
		const next = new URL(request.originalUrl, env.ORIGIN).searchParams.get("next") ?? "";
		return started.pipe(
			HttpServerResponse.setHeader("location", chooser.toString()),
			HttpServerResponse.setCookieUnsafe(RETURN_COOKIE, returnPath(next), {
				...cookie,
				maxAge: Duration.minutes(10),
			}),
		);
	}

	const response = yield* Effect.gen(function* () {
		const { email, emailVerified } = yield* google.finish.pipe(Effect.timeout("10 seconds"));
		if (!email || !emailVerified || !isAllowed(env.ALLOWED_EMAILS, email))
			return failed("not-allowed");
		return yield* Sessions.start(email, returnPath(request.cookies[RETURN_COOKIE]));
	}).pipe(
		Effect.catchTag("OAuthError", (error) =>
			// Not the cause: it holds the token request, client secret included.
			Effect.as(
				Effect.logWarning(`Google sign-in failed: ${error.reason}`),
				failed(PROBLEMS[error.reason]),
			),
		),
		Effect.catchTag("TimeoutError", () =>
			Effect.as(Effect.logWarning("Google sign-in timed out"), failed("failed")),
		),
	);
	return google.clear(HttpServerResponse.expireCookieUnsafe(response, RETURN_COOKIE, cookie));
});
