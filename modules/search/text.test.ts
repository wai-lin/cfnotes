import { describe, expect, it } from "vitest";

import { likePattern, plainText, queryTerms, rankResults, snippet } from "./text.ts";

const text = (t: string) => ({ type: "text", text: t });
const para = (...children: unknown[]) => ({ type: "paragraph", children });
const doc = (...children: unknown[]) => ({ root: { type: "root", children } });

describe("plainText", () => {
	it("joins inline runs without spaces and blocks with one", () => {
		const state = doc(
			para(text("he"), text("llo "), { type: "link", children: [text("world")] }),
			{ type: "heading", children: [text("Next")] },
			{ type: "list", children: [{ type: "listitem", children: [text("one")] }] },
		);
		expect(plainText(state)).toBe("hello world Next one");
	});

	it("includes equations' TeX and embeds' links and bookmark titles", () => {
		const state = doc(
			para(text("Energy"), { type: "equation", equation: "E=mc^2", inline: true }),
			{ type: "equation", equation: "\\int x", inline: false },
			{ type: "embed", url: "https://youtu.be/x", mode: "embed" },
			{
				type: "embed",
				url: "https://a.com",
				mode: "bookmark",
				preview: { title: "A site", description: "About it" },
			},
		);
		expect(plainText(state)).toBe(
			"Energy E=mc^2 \\int x https://youtu.be/x A site About it https://a.com",
		);
	});

	it("includes image captions and file names, and survives junk", () => {
		const state = doc(
			{ type: "image", src: "/x", caption: "A cat" },
			{ type: "file", name: "report.pdf" },
			para(text("a"), { type: "linebreak" }, text("b")),
		);
		expect(plainText(state)).toBe("A cat report.pdf a b");
		expect(plainText(null)).toBe("");
		expect(plainText({ root: 5 })).toBe("");
	});
});

describe("queryTerms / likePattern", () => {
	it("lowercases, dedupes and puts the longest term first", () => {
		expect(queryTerms("  Big  bad BIG wolf ")).toEqual(["wolf", "big", "bad"]);
		expect(queryTerms("   ")).toEqual([]);
	});

	it("escapes LIKE wildcards", () => {
		expect(likePattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
	});
});

describe("rankResults", () => {
	const row = (id: string, title: string, body: string, updated_at: number) => ({
		id,
		title,
		body_text: body,
		updated_at,
	});

	it("keeps rows with every term and puts title matches first", () => {
		const rows = [
			row("body", "Notes", "the alpha plan", 30),
			row("both", "Alpha plan", "", 10),
			row("some", "Alpha", "plan here", 20),
			row("miss", "Alpha", "nothing", 40),
		];
		expect(rankResults(rows, ["alpha", "plan"]).map((r) => r.id)).toEqual(["both", "some", "body"]);
	});
});

describe("snippet", () => {
	it("cuts around the first match on a word boundary", () => {
		const body = `${"lorem ipsum ".repeat(20)}needle in the haystack ${"dolor ".repeat(30)}`;
		const s = snippet(body, ["needle"], 60);
		expect(s.startsWith("…")).toBe(true);
		expect(s.endsWith("…")).toBe(true);
		expect(s).toContain("needle in the haystack");
		expect(s.length).toBeLessThanOrEqual(62);
	});

	it("is empty without a match and uncut for short text", () => {
		expect(snippet("short text", ["zzz"])).toBe("");
		expect(snippet("short text", ["text"])).toBe("short text");
	});
});
