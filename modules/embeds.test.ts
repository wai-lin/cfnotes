import { describe, expect, it } from "vite-plus/test";

import { embedFor, isEmbeddable, parseLink } from "./embeds";

const embed = (raw: string) => embedFor(parseLink(raw)!);

describe("parseLink", () => {
	it("accepts http(s) links and adds https:// to bare ones", () => {
		expect(parseLink("https://example.com/a?b=1")?.href).toBe("https://example.com/a?b=1");
		expect(parseLink("  youtu.be/abc  ")?.href).toBe("https://youtu.be/abc");
	});

	it("rejects text, other schemes and hostnames without a dot", () => {
		for (const raw of [
			"",
			"hello world",
			"javascript:alert(1)",
			"ftp://x.com",
			"intranet",
			"a b.com",
		])
			expect(parseLink(raw)).toBeNull();
	});
});

describe("embedFor", () => {
	it("YouTube watch, short, shorts and embed links play from youtube-nocookie", () => {
		const src = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
		for (const raw of [
			"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
			"https://youtu.be/dQw4w9WgXcQ",
			"https://m.youtube.com/shorts/dQw4w9WgXcQ",
			"https://www.youtube.com/embed/dQw4w9WgXcQ",
		])
			expect(embed(raw)).toMatchObject({ provider: "YouTube", src, aspect: 16 / 9, known: true });
	});

	it("keeps a YouTube start time", () => {
		expect(embed("https://youtu.be/dQw4w9WgXcQ?t=90").src).toMatch(/\?start=90$/);
		expect(embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s").src).toMatch(/\?start=90$/);
	});

	it("Vimeo, Loom, Figma, Spotify, CodePen and Google links", () => {
		expect(embed("https://vimeo.com/76979871").src).toBe("https://player.vimeo.com/video/76979871");
		expect(embed("https://vimeo.com/76979871/abc123").src).toBe(
			"https://player.vimeo.com/video/76979871?h=abc123",
		);
		expect(embed("https://www.loom.com/share/0123abcd").src).toBe(
			"https://www.loom.com/embed/0123abcd",
		);
		const figma = embed("https://www.figma.com/design/KEY/Name?node-id=1-2");
		expect(figma.provider).toBe("Figma");
		expect(figma.src).toContain(encodeURIComponent("https://www.figma.com/design/KEY/Name"));
		expect(embed("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC")).toMatchObject({
			src: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
			height: 152,
		});
		expect(embed("https://open.spotify.com/intl-de/album/1A2B3C").height).toBe(352);
		expect(embed("https://codepen.io/someone/pen/abcXYZ").src).toBe(
			"https://codepen.io/someone/embed/abcXYZ?default-tab=result",
		);
		expect(embed("https://docs.google.com/document/d/DOC_id-1/edit")).toMatchObject({
			provider: "Google Docs",
			src: "https://docs.google.com/document/d/DOC_id-1/preview",
		});
		expect(embed("https://docs.google.com/presentation/d/SLIDES/edit").src).toBe(
			"https://docs.google.com/presentation/d/SLIDES/embed",
		);
		expect(embed("https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z").src).toBe(
			`https://maps.google.com/maps?q=${encodeURIComponent("Eiffel Tower")}&output=embed`,
		);
	});

	it("any other page is framed as itself", () => {
		expect(embed("https://example.com/page")).toMatchObject({
			provider: "example.com",
			src: "https://example.com/page",
			known: false,
		});
	});

	it("only services with a player count as embeddable", () => {
		expect(isEmbeddable(parseLink("https://youtu.be/abc")!)).toBe(true);
		expect(isEmbeddable(parseLink("https://www.youtube.com/feed")!)).toBe(false);
		expect(isEmbeddable(parseLink("https://example.com")!)).toBe(false);
	});
});
