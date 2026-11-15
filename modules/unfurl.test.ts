import { describe, expect, it } from "vite-plus/test";

import { fetchable, parsePreview } from "./unfurl";

const base = new URL("https://www.example.com/blog/post");

describe("parsePreview", () => {
	it("prefers Open Graph tags and resolves relative URLs", () => {
		const html = `<html><head>
			<title>Plain title</title>
			<meta property="og:title" content="OG &amp; title">
			<meta name="description" content="Fallback">
			<meta property="og:description" content='The  "best"
				post'>
			<meta property="og:image" content="/img/cover.png">
			<meta property="og:site_name" content="Example Blog">
			<link rel="apple-touch-icon" href="/apple.png">
			<link rel="icon" href="favicon.svg">
		</head><body><meta property="og:title" content="ignored"></body></html>`;
		expect(parsePreview(html, base)).toEqual({
			url: "https://www.example.com/blog/post",
			title: "OG & title",
			description: 'The "best" post',
			image: "https://www.example.com/img/cover.png",
			icon: "https://www.example.com/blog/favicon.svg",
			site: "Example Blog",
		});
	});

	it("falls back to <title>, the description meta, /favicon.ico and the host", () => {
		const html =
			"<head><TITLE>Hi &#8212; there</TITLE><meta name=description content=Short></head>";
		expect(parsePreview(html, base)).toMatchObject({
			title: "Hi — there",
			description: "Short",
			image: null,
			icon: "https://www.example.com/favicon.ico",
			site: "example.com",
		});
	});

	it("a page it couldn't read still gets a card", () => {
		expect(parsePreview("", base)).toMatchObject({ title: "www.example.com", description: "" });
	});

	it("drops non-web image addresses", () => {
		const html = `<meta property="og:image" content="javascript:alert(1)">`;
		expect(parsePreview(html, base).image).toBeNull();
	});
});

describe("fetchable", () => {
	it("allows public web addresses", () => {
		for (const raw of ["https://example.com/x", "http://news.site.org", "https://8.8.8.8/"])
			expect(fetchable(new URL(raw))).toBe(true);
	});

	it("refuses local, private and odd addresses", () => {
		for (const raw of [
			"http://localhost:5173/",
			"http://app.localhost/",
			"http://127.0.0.1/",
			"http://10.0.0.5/",
			"http://172.20.1.1/",
			"http://192.168.1.1/",
			"http://169.254.169.254/latest",
			"http://[::1]/",
			"http://printer.local/",
			"https://example.com:8443/",
			"https://user:pw@example.com/",
			"ftp://example.com/",
			"http://intranet/",
		])
			expect(fetchable(new URL(raw)), raw).toBe(false);
	});
});
