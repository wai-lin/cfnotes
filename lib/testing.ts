/** The whole app in memory, with a stand-in for Google, and the requests its browser code makes. For tests. */
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
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
		manifest,
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

	return {
		fetch,
		anonymous: app.fetch,
		google,
		signIn,
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
