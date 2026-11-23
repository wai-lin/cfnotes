import { describe, expect, it } from "vitest";

import { indents } from "./logic.ts";

describe("table of contents", () => {
	it("indents by level, from the page's biggest heading", () => {
		const entry = (level: number) => ({ key: String(level), level, text: "x" });
		expect(indents([entry(2), entry(3), entry(2)])).toEqual([0, 1, 0]);
		expect(indents([entry(1), entry(3)])).toEqual([0, 2]);
	});
});
