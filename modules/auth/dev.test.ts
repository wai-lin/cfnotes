import { describe, expect, it } from "vitest";

import { cfnotes, cookiesOf } from "#lib/testing.ts";

const form = (fields: Record<string, string>, origin = "http://localhost:1337") => ({
	method: "POST",
	headers: { "content-type": "application/x-www-form-urlencoded", origin },
	body: new URLSearchParams(fields).toString(),
});

describe("signing in without Google, on localhost", () => {
	it("signs in an owner and goes back to the page", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const response = await app.anonymous(
			"http://localhost:1337/auth/dev",
			form({ email: "owner@example.com", next: path }),
		);
		expect(response.headers.get("location")).toBe(path);
		const cookie = cookiesOf(response);
		expect(cookie).toMatch(/(^|; )session=/);
		expect((await app.anonymous(path, { headers: { cookie } })).status).toBe(200);
	});

	it("is offered on the sign-in page", async () => {
		await using app = cfnotes();
		const page = await (await app.anonymous("http://localhost:1337/login")).text();
		expect(page).toContain('action="/auth/dev"');
		expect(page).toContain("owner@example.com");
	});

	it("refuses someone who may not sign in", async () => {
		await using app = cfnotes();
		const response = await app.anonymous(
			"http://localhost:1337/auth/dev",
			form({ email: "stranger@example.com" }),
		);
		expect(response.headers.get("location")).toBe("/login?error=not-allowed");
		expect(cookiesOf(response)).not.toMatch(/(^|; )session=/);
	});

	it("isn't there for a request to another host", async () => {
		await using app = cfnotes();
		const response = await app.anonymous(
			"http://app.test/auth/dev",
			form({ email: "owner@example.com" }, "http://app.test"),
		);
		expect(response.status).toBe(404);
		expect(await (await app.anonymous("http://app.test/login")).text()).not.toContain("/auth/dev");
	});

	it("isn't there when the app is served over https", async () => {
		await using app = cfnotes({ ORIGIN: "https://notes.example.com" });
		const response = await app.anonymous(
			"http://localhost:1337/auth/dev",
			form({ email: "owner@example.com" }),
		);
		expect(response.status).toBe(404);
	});
});
