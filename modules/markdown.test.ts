import { describe, expect, it } from "vite-plus/test";

import { looksLikeMarkdown } from "./markdown";

describe("looksLikeMarkdown", () => {
	it("spots block markdown", () => {
		expect(looksLikeMarkdown("# Title\n\nBody")).toBe(true);
		expect(looksLikeMarkdown("Intro\n- a\n- b")).toBe(true);
		expect(looksLikeMarkdown("1. one\n2. two")).toBe(true);
		expect(looksLikeMarkdown("```js\nlet a\n```")).toBe(true);
		expect(looksLikeMarkdown("above\n---\nbelow")).toBe(true);
		expect(looksLikeMarkdown("> a quote")).toBe(true);
		expect(looksLikeMarkdown("## Heading")).toBe(true);
	});

	it("spots inline markdown", () => {
		expect(looksLikeMarkdown("some **bold** text")).toBe(true);
		expect(looksLikeMarkdown("see [docs](https://x.com/a)")).toBe(true);
		expect(looksLikeMarkdown("run `npm i`")).toBe(true);
	});

	it("leaves prose, URLs and lone list-like lines alone", () => {
		expect(looksLikeMarkdown("Just a sentence. Another one.")).toBe(false);
		expect(looksLikeMarkdown("https://example.com/a_b_c")).toBe(false);
		expect(looksLikeMarkdown("- see above")).toBe(false);
		expect(looksLikeMarkdown("2. because reasons")).toBe(false);
		expect(looksLikeMarkdown("first line\nsecond line")).toBe(false);
		expect(looksLikeMarkdown("#hashtag and 5*3*2")).toBe(false);
		expect(looksLikeMarkdown("   ")).toBe(false);
	});
});
