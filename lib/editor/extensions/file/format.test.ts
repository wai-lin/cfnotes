import { describe, expect, it } from "vitest";

import { formatSize } from "./format.ts";

describe("formatSize", () => {
	it("uses B, KB and MB", () => {
		expect(formatSize(512)).toBe("512 B");
		expect(formatSize(40 * 1024 + 300)).toBe("40 KB");
		expect(formatSize(3.24 * 1024 * 1024)).toBe("3.2 MB");
	});
});
