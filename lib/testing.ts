/** The whole app in memory, with a stand-in for Google, and the requests its browser code makes. For tests. */
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { Input, route } from "spacefn";
import { memoryServices, testApp, testDb, testEnv } from "spacefn/testing";

import Env from "#configs/env.ts";
import MainDb from "#space/db/main.ts";
import { manifest } from "#space/manifest.ts";

export const TEST_ENV = {
	ORIGIN: "http://localhost:1337",
	GOOGLE_CLIENT_ID: "test-client",
	GOOGLE_CLIENT_SECRET: "test-secret",
	ALLOWED_EMAILS: "owner@example.com",
};

/** Google's token and userinfo endpoints. Its profile can be changed by a test. */
function fakeGoogle() {
	const google = {
		profile: { sub: "1", email: "owner@example.com", email_verified: true } as object,
		/** Whether the token endpoint takes the code. */
		accepts: true,
		/** The forms posted to the token endpoint. */
		exchanges: [] as URLSearchParams[],
	};
	const layer = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.sync(() => {
				const answer = (body: object, status = 200) =>
					HttpClientResponse.fromWeb(request, Response.json(body, { status }));
				if (url.href === "https://openidconnect.googleapis.com/v1/userinfo")
					return answer(google.profile);
				if (url.href !== "https://oauth2.googleapis.com/token") return answer({}, 404);
				if (request.body._tag === "Uint8Array")
					google.exchanges.push(new URLSearchParams(new TextDecoder().decode(request.body.body)));
				return google.accepts
					? answer({ access_token: "test-token" })
					: answer({ error: "invalid_grant" }, 400);
			}),
		),
	);
	return { google, layer };
}

const TOKEN_PATH = "/test/api-token";

/**
 * Makes an API token for `email`, as `modules/auth/tokens.ts` stores one (a
 * SHA-256 hash of `cfn_…`). A route only tests have: the tokens page can't be
 * rendered here.
 */
const tokenRoute = route({
	POST: Effect.gen(function* () {
		const { email, scope } = yield* Input.body(
			Schema.Struct({ email: Schema.String, scope: Schema.String }),
		);
		const token = `cfn_test${crypto.randomUUID().replaceAll("-", "")}`;
		const digest = yield* Effect.promise(() =>
			crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
		);
		const tokenHash = [...new Uint8Array(digest)]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		yield* MainDb.createApiToken({
			id: crypto.randomUUID(),
			name: "test",
			tokenHash,
			scope,
			now: Date.now(),
			by: email,
		});
		return { token };
	}),
});

/** The cookies a response sets, as the browser sends them back. */
export const cookiesOf = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0]!)
		.join("; ");

/** The app. `fetch`, `post` and `open` are signed in; `anonymous` isn't. */
export function cfnotes(env: Partial<typeof TEST_ENV> = {}) {
	const { google, layer } = fakeGoogle();
	const app = testApp(
		{
			...manifest,
			routes: [
				...manifest.routes,
				{ path: TOKEN_PATH, params: [], file: "lib/testing.ts", module: { default: tokenRoute } },
			],
		},
		Layer.mergeAll(
			testDb(MainDb),
			memoryServices,
			layer,
			Env.layer.pipe(Layer.provide(testEnv({ ...TEST_ENV, ...env }))),
		),
	);

	/** Goes to Google and back: the callback's response. */
	async function signIn(next?: string) {
		const started = await app.fetch(`/auth/google${next ? `?next=${next}` : ""}`);
		const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
		return app.fetch(`/auth/google?code=test-code&state=${state}`, {
			headers: { cookie: cookiesOf(started) },
		});
	}

	let session: Promise<string> | undefined;

	async function fetch(path: string, init: RequestInit = {}) {
		session ??= signIn().then(cookiesOf);
		const headers = new Headers(init.headers);
		if (!headers.has("cookie")) headers.set("cookie", await session);
		// Browsers send it with every post, and csrf wants it from a signed-in one.
		if (init.method && init.method !== "GET" && !headers.has("origin"))
			headers.set("origin", "http://app.test");
		return app.fetch(path, { ...init, headers });
	}

	/** Requests made with `cookie`, as a browser signed in with it sends them. */
	const withCookie = (cookie: string) => {
		const as = (path: string, init: RequestInit = {}) => {
			const headers = new Headers(init.headers);
			headers.set("cookie", cookie);
			if (init.method && init.method !== "GET" && !headers.has("origin"))
				headers.set("origin", "http://app.test");
			return app.fetch(path, { ...init, headers });
		};
		return {
			cookie,
			fetch: as,
			post: (path: string, action: string, body: unknown) =>
				as(`${path}?__action=${action}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}),
		};
	};

	return {
		fetch,
		anonymous: app.fetch,
		/**
		 * Someone else, signed in through Google as `email` (a friend a page is
		 * shared with, say). `signedIn` is false when Google's answer was refused.
		 */
		async as(email: string) {
			const before = google.profile;
			google.profile = { sub: email, email, email_verified: true };
			const response = await signIn();
			google.profile = before;
			const signedIn = !(response.headers.get("location") ?? "").includes("error=");
			return { ...withCookie(cookiesOf(response)), signedIn };
		},
		google,
		signIn,
		/** An API token, made by `email` (the owner by default). */
		async token(scope: "read" | "write" = "write", email = "owner@example.com") {
			const res = await fetch(TOKEN_PATH, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ email, scope }),
			});
			return ((await res.json()) as { token: string }).token;
		},
		/** A request to the API with `token`. */
		api: (token: string, path: string, init: RequestInit & { json?: unknown } = {}) => {
			const headers = new Headers(init.headers);
			headers.set("authorization", `Bearer ${token}`);
			const { json, ...rest } = init;
			if (json !== undefined) headers.set("content-type", "application/json");
			return app.fetch(path, {
				...rest,
				headers,
				...(json !== undefined ? { body: JSON.stringify(json) } : {}),
			});
		},
		/** A page action called with JSON, as the browser code and Datastar's `@post` do. */
		post: (path: string, action: string, body: unknown) =>
			fetch(`${path}?__action=${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		/** Opens the workspace: the first page's path and id. */
		async open() {
			const path = (await fetch("/")).headers.get("location")!;
			return { path, id: path.split("/").pop()! };
		},
		[Symbol.asyncDispose]: app.dispose,
	};
}
