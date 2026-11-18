import { describe, expect, it } from "vite-plus/test";

import { formatSize } from "./format";

describe("formatSize", () => {
	it("uses B, KB and MB", () => {
		expect(formatSize(512)).toBe("512 B");
		expect(formatSize(40 * 1024 + 300)).toBe("40 KB");
		expect(formatSize(3.24 * 1024 * 1024)).toBe("3.2 MB");
	});
});
