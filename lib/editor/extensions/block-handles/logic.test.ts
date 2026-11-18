import { describe, expect, it } from "vite-plus/test";

import { dropPlacement } from "./logic";

const rect = { left: 100, right: 700, top: 50, height: 40, width: 600 };

describe("dropPlacement", () => {
	it("drops before or after by the half the pointer is in", () => {
		expect(dropPlacement(rect, 300, 60, true)).toEqual({ before: true, side: null });
		expect(dropPlacement(rect, 300, 80, true)).toEqual({ before: false, side: null });
	});

	it("makes a column past the block's right part or left of the grip", () => {
		expect(dropPlacement(rect, 650, 60, true).side).toBe("right");
		expect(dropPlacement(rect, 60, 60, true).side).toBe("left");
		// A little left of the block is still the grip's drift, not a side drop.
		expect(dropPlacement(rect, 80, 60, true).side).toBeNull();
	});

	it("never drops beside without columns", () => {
		expect(dropPlacement(rect, 650, 60, false).side).toBeNull();
	});
});
