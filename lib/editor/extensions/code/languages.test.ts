import { describe, expect, it } from "vitest";

import { languageName, resolveLanguage, searchLanguages } from "./languages.ts";

describe("resolveLanguage", () => {
	it("maps aliases to Shiki ids and plain text to null", () => {
		expect(resolveLanguage("ts")).toBe("typescript");
		expect(resolveLanguage("plaintext")).toBeNull();
		expect(resolveLanguage(undefined)).toBeNull();
		expect(resolveLanguage("not-a-language")).toBeNull();
	});

	it("names languages for the picker", () => {
		expect(languageName("js")).toBe("JavaScript");
		expect(languageName(null)).toBe("Plain text");
	});
});

describe("searchLanguages", () => {
	it("starts with plain text and the popular ones", () => {
		expect(
			searchLanguages("")
				.slice(0, 3)
				.map((o) => o.id),
		).toEqual(["plaintext", "javascript", "typescript"]);
	});

	it("puts names starting with the query first", () => {
		expect(searchLanguages("py")[0]?.id).toBe("python");
	});
});
