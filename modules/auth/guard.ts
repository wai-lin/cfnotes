/** Everything is private unless it's listed here. */
import { Effect, Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { middleware, redirect } from "spacefn";

import { returnPath } from "./access.ts";
import { PATH as GOOGLE } from "./google.ts";
import * as Sessions from "./sessions.ts";

// Exact paths, so another spelling of one is private rather than public.
const PUBLIC = new Set(["/login", GOOGLE, "/logout"]);

/** Tells `client/session.ts` that a 401 is ours. */
const SIGNED_OUT = "x-signed-out";

const refuse = (request: HttpServerRequest.HttpServerRequest, path: string) => {
	const navigating =
		request.headers["datastar-request"] !== "true" &&
		request.headers["accept"]?.startsWith("text/html");
	if (navigating) {
		const next = returnPath(path);
		return redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
	}
	return HttpServerResponse.jsonUnsafe(
		{ error: "Unauthorized", message: "Sign in first" },
		{ status: 401, headers: { [SIGNED_OUT]: "1" } },
	);
};

export const signedInOnly = middleware((next) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const path = request.url.split("?")[0]!;
		const allowed = PUBLIC.has(path) || Option.isSome(yield* Sessions.user);
		const response = allowed ? yield* next : refuse(request, path);
		return response.headers["cache-control"]
			? response
			: HttpServerResponse.setHeader(response, "cache-control", "no-store");
	}),
);
