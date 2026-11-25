import { describe, expect, it } from "vitest";

import { centred, fit, MAX_SCALE, MIN_SCALE, panBy, wheelFactor, zoomAt } from "./camera.ts";

describe("the diagram viewer's camera", () => {
	it("zooms around the pointer, keeping that point still", () => {
		const next = zoomAt({ x: 10, y: 20, scale: 1 }, 2, 110, 120);
		expect(next).toEqual({ x: -90, y: -80, scale: 2 });
		// The point under the pointer: (110 - 10) / 1 before, (110 + 90) / 2 after.
		expect((110 - next.x) / next.scale).toBe(100);
	});

	it("stays between the smallest and largest zoom", () => {
		expect(zoomAt({ x: 0, y: 0, scale: 1 }, 1000, 0, 0).scale).toBe(MAX_SCALE);
		expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0.0001, 0, 0).scale).toBe(MIN_SCALE);
	});

	it("pans by stage pixels", () => {
		expect(panBy({ x: 1, y: 2, scale: 3 }, 10, -5)).toEqual({ x: 11, y: -3, scale: 3 });
	});

	it("fits the whole diagram, centred, without blowing small ones up", () => {
		const stage = { width: 1064, height: 564 };
		expect(fit({ width: 2000, height: 500 }, stage)).toEqual({ scale: 0.5, x: 32, y: 157 });
		expect(fit({ width: 100, height: 100 }, stage).scale).toBe(2);
		expect(centred({ width: 100, height: 50 }, { width: 300, height: 150 }, 1)).toEqual({
			scale: 1,
			x: 100,
			y: 50,
		});
	});

	it("wheels up to zoom in, pinches faster, and reads line-based wheels as pixels", () => {
		expect(wheelFactor(-100, 0, false)).toBeGreaterThan(1);
		expect(wheelFactor(100, 0, false)).toBeLessThan(1);
		expect(wheelFactor(-10, 0, true)).toBeCloseTo(wheelFactor(-50, 0, false));
		expect(wheelFactor(3, 1, false)).toBeCloseTo(wheelFactor(48, 0, false));
	});
});
