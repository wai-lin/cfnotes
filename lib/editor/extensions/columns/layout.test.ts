import { describe, expect, it } from "vite-plus/test";

import { equalWidths, gridTemplate, MIN_SHARE, splitAt, validWidths } from "./layout";

describe("column widths", () => {
	it("start equal and make a grid template", () => {
		expect(equalWidths(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
		expect(gridTemplate([0.5, 0.5])).toBe("minmax(0, 0.5000fr) minmax(0, 0.5000fr)");
	});

	it("are checked against the column count and their total", () => {
		expect(validWidths([0.3, 0.7], 2)).toBe(true);
		expect(validWidths([0.3, 0.7], 3)).toBe(false);
		expect(validWidths([0.3, 0.6], 2)).toBe(false);
	});

	it("split a pair where the pointer is, keeping the others", () => {
		const next = splitAt([0.25, 0.25, 0.5], 0, 175, 100, 300);
		expect(next[0]).toBeCloseTo(0.1875);
		expect(next[1]).toBeCloseTo(0.3125);
		expect(next[2]).toBe(0.5);
	});

	it("never squeeze a column below the minimum", () => {
		const [a, b] = splitAt([0.5, 0.5], 0, 0, 100, 300);
		expect(a).toBeCloseTo(MIN_SHARE);
		expect(b).toBeCloseTo(1 - MIN_SHARE);
	});
});
