import { describe, expect, it } from "vitest";

import { normalizeUrl } from "./logic.ts";

describe("normalizeUrl", () => {
	it("keeps full links", () => {
		expect(normalizeUrl(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
		expect(normalizeUrl("mailto:someone@example.com")).toBe("mailto:someone@example.com");
	});

	it("adds https to bare domains", () => {
		expect(normalizeUrl("example.com/docs")).toBe("https://example.com/docs");
	});

	it("turns down anything else", () => {
		expect(normalizeUrl("")).toBeNull();
		expect(normalizeUrl("not a link")).toBeNull();
		expect(normalizeUrl("javascript:alert(1)")).toBeNull();
	});
});
