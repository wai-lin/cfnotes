import { describe, expect, it } from "vitest";

import { cfnotes, cookiesOf } from "#lib/testing.ts";
import { manifest } from "#space/manifest.ts";

const PUBLIC = ["/login", "/auth/google", "/logout"];

describe("the guard", () => {
	it("covers every route and method in the app", async () => {
		await using app = cfnotes();
		const paths = manifest.routes
			.map((entry) => entry.path.replace(/:\w+/g, "x").replace("*", "x"))
			.filter((path) => !PUBLIC.includes(path));
		expect(paths.length).toBeGreaterThan(8);
		for (const path of paths) {
			for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
				const response = await app.anonymous(path, { method });
				expect(response.status, `${method} ${path}`).toBe(401);
				expect(response.headers.get("x-signed-out")).toBe("1");
			}
		}
	});

	it("isn't fooled by other spellings of a public or private path", async () => {
		await using app = cfnotes();
		const paths = [
			"/login/../trash",
			"/login%2F..%2Ftrash",
			"/login/",
			"/LOGIN",
			"//trash",
			"/trash/",
			"/TRASH",
			"/%74rash",
			"/search?next=/login",
			"/files/img/login",
			"/no-such-route",
		];
		for (const path of paths) {
			const response = await app.anonymous(`http://app.test${path}`);
			expect(response.status, path).toBe(401);
		}
	});

	it("refuses actions without running them", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const refused = await app.anonymous(`${path}?__action=title`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: "http://app.test" },
			body: JSON.stringify({ title: "Taken over" }),
		});
		expect(refused.status).toBe(401);
		expect(await (await app.fetch(path)).text()).not.toContain("Taken over");
	});

	it("sends a browser to sign in, and back to the page afterwards", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const accept = { accept: "text/html,*/*" };

		const refused = await app.anonymous(path, { headers: accept });
		expect(refused.status).toBe(303);
		const login = refused.headers.get("location")!;
		expect(login).toBe(`/login?next=${encodeURIComponent(path)}`);
		expect(await (await app.anonymous(login)).text()).toContain(
			`http://localhost:1337/auth/google?next=${encodeURIComponent(path)}`,
		);
		expect((await app.signIn(path)).headers.get("location")).toBe(path);

		const datastar = { accept: "text/html", "datastar-request": "true" };
		expect((await app.anonymous(path, { headers: datastar })).status).toBe(401);
	});

	it("refuses a made-up cookie", async () => {
		await using app = cfnotes();
		for (const token of ["nope", "A".repeat(43)]) {
			const response = await app.anonymous("/trash", { headers: { cookie: `session=${token}` } });
			expect(response.status).toBe(401);
		}
	});

	it("keeps private responses out of shared caches", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		expect((await app.fetch(path)).headers.get("cache-control")).toBe("no-store");
		expect((await app.anonymous("/login")).headers.get("cache-control")).toBe("no-store");
	});
});

describe("sign in with Google", () => {
	it("starts with state, PKCE and the account chooser", async () => {
		await using app = cfnotes();
		const started = await app.anonymous("/auth/google");
		const url = new URL(started.headers.get("location")!);
		expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: "test-client",
			redirect_uri: "http://localhost:1337/auth/google",
			response_type: "code",
			scope: "openid email profile",
			code_challenge_method: "S256",
			prompt: "select_account",
		});
		expect(url.searchParams.get("state")).toBeTruthy();
		expect(started.headers.getSetCookie().join("\n")).toContain("oauth_google=");
	});

	it("trades the code with the verifier and secret, then shows who's signed in", async () => {
		await using app = cfnotes();
		const response = await app.signIn();
		expect(response.headers.get("location")).toBe("/");
		expect(Object.fromEntries(app.google.exchanges[0]!)).toMatchObject({
			grant_type: "authorization_code",
			code: "test-code",
			client_secret: "test-secret",
			code_verifier: expect.any(String),
			redirect_uri: "http://localhost:1337/auth/google",
		});
		const { path } = await app.open();
		expect(await (await app.fetch(path)).text()).toContain("owner@example.com");
		expect((await app.fetch("/auth/session")).status).toBe(204);
		expect((await app.fetch("/login")).headers.get("location")).toBe("/");
	});

	it.each([
		["another account", { sub: "2", email: "stranger@example.com", email_verified: true }],
		["an unverified email", { sub: "2", email: "owner@example.com", email_verified: false }],
		["an email with no verified flag", { sub: "2", email: "owner@example.com" }],
		["an account without an email", { sub: "2", email_verified: true }],
	])("refuses %s", async (_, profile) => {
		await using app = cfnotes();
		app.google.profile = profile;
		const response = await app.signIn();
		expect(response.headers.get("location")).toBe("/login?error=not-allowed");
		expect(cookiesOf(response)).not.toMatch(/(^|; )session=/);
	});

	it("refuses a callback this browser didn't start", async () => {
		await using app = cfnotes();
		const started = await app.anonymous("/auth/google");
		const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
		const forged = [
			app.anonymous(`/auth/google?code=c&state=${state}`),
			app.anonymous("/auth/google?code=c&state=forged", {
				headers: { cookie: cookiesOf(started) },
			}),
		];
		for (const response of await Promise.all(forged))
			expect(response.headers.get("location")).toBe("/login?error=expired");
		expect(app.google.exchanges).toHaveLength(0);
	});

	it("explains a cancelled or failed sign-in", async () => {
		await using app = cfnotes();
		const cancelled = await app.anonymous("/auth/google?error=access_denied");
		expect(cancelled.headers.get("location")).toBe("/login?error=cancelled");

		app.google.accepts = false;
		const failed = await app.signIn();
		expect(failed.headers.get("location")).toBe("/login?error=failed");
		expect(await (await app.anonymous("/login?error=failed")).text()).toContain(
			"sign in with Google. Try again",
		);
	});

	it("doesn't show an error it doesn't know", async () => {
		await using app = cfnotes();
		for (const error of ["<script>x</script>", "constructor"]) {
			const text = await (await app.anonymous(`/login?error=${encodeURIComponent(error)}`)).text();
			expect(text).not.toContain("login-error");
		}
	});

	it("doesn't go back to another site", async () => {
		await using app = cfnotes();
		expect((await app.signIn("//evil.test")).headers.get("location")).toBe("/");
	});

	it("marks cookies Secure on https, and not on localhost", async () => {
		await using local = cfnotes();
		await using live = cfnotes({ ORIGIN: "https://notes.example.com" });
		const session = async (app: typeof local) =>
			(await app.signIn()).headers.getSetCookie().find((cookie) => cookie.startsWith("session="))!;
		expect(await session(live)).toMatch(/; Secure/);
		expect(await session(live)).toMatch(/HttpOnly/);
		expect(await session(live)).toMatch(/SameSite=Lax/);
		expect(await session(local)).not.toMatch(/; Secure/);
	});

	it.each([
		{ ORIGIN: "http://notes.example.com" },
		{ ORIGIN: "https://notes.example.com/" },
		{ ALLOWED_EMAILS: "" },
		{ ALLOWED_EMAILS: "*" },
		{ GOOGLE_CLIENT_ID: "" },
	])("won't start with %o", async (env) => {
		await using app = cfnotes(env);
		await expect(app.anonymous("/login")).rejects.toThrow();
	});
});

describe("sessions", () => {
	it("end on sign-out, not just in the browser", async () => {
		await using app = cfnotes();
		const cookie = cookiesOf(await app.signIn());
		const out = await app.fetch("/logout", { method: "POST", headers: { cookie } });
		expect(out.headers.get("location")).toBe("/login");
		expect((await app.anonymous("/trash", { headers: { cookie } })).status).toBe(401);
	});

	it("can't be ended by another site", async () => {
		await using app = cfnotes();
		const out = await app.fetch("/logout", {
			method: "POST",
			headers: { origin: "https://evil.test" },
		});
		expect(out.status).toBe(403);
		expect((await app.fetch("/trash")).status).toBe(200);
	});
});
