import { describe, expect, it } from "vitest";

import { isAllowed, returnPath } from "./access.ts";

describe("isAllowed", () => {
	it("takes commas or spaces, and any case", () => {
		const list = "One@Example.com, two@example.com three@example.com";
		for (const email of ["one@example.com", "TWO@example.com", "three@example.com"])
			expect(isAllowed(list, email)).toBe(true);
	});

	it("matches whole addresses only", () => {
		for (const email of [
			"",
			"*",
			"one@example.com.evil.test",
			"someone@example.com",
			"@example.com",
		])
			expect(isAllowed("one@example.com", email)).toBe(false);
	});

	it("doesn't fold look-alike letters into ASCII", () => {
		expect(isAllowed("kim@example.com", "Kim@example.com")).toBe(false);
	});
});

describe("returnPath", () => {
	it("keeps the app's pages", () => {
		expect(returnPath("/p/abc-123")).toBe("/p/abc-123");
		expect(returnPath("/trash")).toBe("/trash");
	});

	it("sends anything else home", () => {
		const elsewhere = [
			"//evil.test",
			"https://evil.test/p/a",
			"/\\evil.test",
			"/p/../logout",
			"/p/a?next=//evil.test",
			"/p/a\n",
			"/files/img/a",
			"",
		];
		for (const path of elsewhere) expect(returnPath(path)).toBe("/");
		expect(returnPath()).toBe("/");
	});
});
