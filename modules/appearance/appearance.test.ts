import { describe, expect, it } from "vitest";

import { parseAppearance, resolveAppearance } from "./appearance.ts";

describe("appearance", () => {
	it("reads a saved choice, and falls back to the defaults", () => {
		expect(parseAppearance('{"theme":"paper","font":"typewriter"}')).toEqual({
			theme: "paper",
			font: "typewriter",
		});
		for (const raw of [
			null,
			"",
			"nope",
			"null",
			'{"theme":"neon","font":1}',
			'{"theme":"toString"}',
		])
			expect(parseAppearance(raw)).toEqual({ theme: "system", font: "sans" });
	});

	it("resolves System from the device, and gives each theme its scheme and bar colour", () => {
		const pick = (theme: "system" | "paper" | "dusk", dark: boolean) =>
			resolveAppearance({ theme, font: "sans" }, dark);
		expect(pick("system", false)).toMatchObject({
			theme: "light",
			scheme: "light",
			color: "#ffffff",
		});
		expect(pick("system", true)).toMatchObject({ theme: "dark", scheme: "dark", color: "#191919" });
		expect(pick("paper", true)).toMatchObject({ theme: "paper", scheme: "light" });
		expect(pick("dusk", false)).toMatchObject({ theme: "dusk", scheme: "dark", color: "#2b2a28" });
	});
});
