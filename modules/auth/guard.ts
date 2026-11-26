/** Everything is private unless it's listed here. */
import { Effect, Option } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { middleware, redirect } from "spacefn";

import { PATHS as DOCS } from "#modules/api/docs.ts";

import { returnPath } from "./access.ts";
import { PATH as DEV } from "./dev.ts";
import { PATH as GOOGLE } from "./google.ts";
import * as Sessions from "./sessions.ts";
import { isApiPath } from "./tokens.ts";

// Exact paths, so another spelling of one is private rather than public.
// `DEV` answers 404 unless on localhost (`dev.ts`).
const PUBLIC = new Set<string>(["/login", GOOGLE, DEV, "/logout", ...DOCS]);

/** Tells `client/session.ts` that a 401 is ours. */
const SIGNED_OUT = "x-signed-out";

const refuse = (request: HttpServerRequest.HttpServerRequest, path: string) => {
	if (isApiPath(path))
		return HttpServerResponse.jsonUnsafe(
			{ error: "Unauthorized", message: "Send an API token: Authorization: Bearer cfn_…" },
			{ status: 401, headers: { "www-authenticate": 'Bearer realm="cfnotes"' } },
		);
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

/**
 * What a friend (signed in through a share, not on ALLOWED_EMAILS) may reach:
 * pages, which check what's shared with them action by action, files, their
 * API tokens, and the API, where each request checks what's shared the same
 * way. Uploads and link previews only for someone who may edit something.
 */
const GUEST_READS = /^\/(p\/[\w-]+|files\/(img|file|media)\/[\w.-]+|auth\/session|tokens)?$/;
const GUEST_WRITES = /^\/(files|files\/attach|files\/media|unfurl)$/;

const guestMay = Effect.fn("guestMay")(function* (method: string, path: string, email: string) {
	if (isApiPath(path)) return true;
	if (GUEST_READS.test(path))
		return method === "GET" || method === "HEAD" || path.startsWith("/p/") || path === "/tokens";
	if (GUEST_WRITES.test(path)) return yield* Sessions.editsSomething(email);
	return false;
});

const forbidden = (request: HttpServerRequest.HttpServerRequest) =>
	request.headers["datastar-request"] !== "true" &&
	request.headers["accept"]?.startsWith("text/html")
		? redirect("/")
		: HttpServerResponse.jsonUnsafe(
				{ error: "Forbidden", message: "That isn't shared with you" },
				{ status: 403 },
			);

export const signedInOnly = middleware((next) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const path = request.url.split("?")[0]!;
		const user = Option.getOrUndefined(yield* Sessions.user);
		let response: HttpServerResponse.HttpServerResponse;
		if (PUBLIC.has(path)) response = yield* next;
		else if (!user) response = refuse(request, path);
		else if (
			(yield* Sessions.isOwner(user.email)) ||
			(yield* guestMay(request.method, path, user.email))
		)
			response = yield* next;
		else response = forbidden(request);
		return response.headers["cache-control"]
			? response
			: HttpServerResponse.setHeader(response, "cache-control", "no-store");
	}),
);
