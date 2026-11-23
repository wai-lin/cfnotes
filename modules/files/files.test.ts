import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { byteRange, mediaType } from "./files.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const upload = (bytes: Uint8Array<ArrayBuffer>, name: string, type: string) => {
	const body = new FormData();
	body.append("file", new File([bytes], name, { type }));
	return { method: "POST", body };
};

describe("mediaType", () => {
	const bytes = (text: string, ...more: number[]) =>
		new Uint8Array([...new TextEncoder().encode(text), ...more]);
	it("knows audio, video and PDFs by their first bytes", () => {
		expect(mediaType(bytes("%PDF-1.7"))).toBe("application/pdf");
		expect(mediaType(bytes("\0\0\0 ftypM4A "))).toBe("audio/mp4");
		expect(mediaType(bytes("\0\0\0 ftypqt  "))).toBe("video/quicktime");
		expect(mediaType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe("video/webm");
		expect(mediaType(bytes("ID3\x04"))).toBe("audio/mpeg");
		expect(mediaType(new Uint8Array([0xff, 0xfb, 0x90]))).toBe("audio/mpeg");
		expect(mediaType(new Uint8Array([0xff, 0xf1, 0x50]))).toBe("audio/aac");
		expect(mediaType(bytes("RIFF\0\0\0\0WAVE"))).toBe("audio/wav");
		expect(mediaType(bytes("RIFF\0\0\0\0WEBP"))).toBeUndefined();
		expect(mediaType(bytes("<svg"))).toBeUndefined();
	});
});

describe("byteRange", () => {
	it("reads the ranges players ask for", () => {
		expect(byteRange("bytes=0-", 10)).toEqual({ start: 0, end: 9 });
		expect(byteRange("bytes=2-4", 10)).toEqual({ start: 2, end: 4 });
		expect(byteRange("bytes=8-99", 10)).toEqual({ start: 8, end: 9 });
		expect(byteRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
		expect(byteRange("bytes=10-", 10)).toBeNull();
		expect(byteRange("bytes=5-2", 10)).toBeNull();
		expect(byteRange("bytes=0-1,4-5", 10)).toBeNull();
		expect(byteRange(undefined, 10)).toBeNull();
	});
});

describe("files", () => {
	it("serves an uploaded image inline", async () => {
		await using app = cfnotes();
		const res = await app.fetch("/files", upload(PNG, "a.png", "image/png"));
		expect(res.status).toBe(201);
		const { key } = (await res.json()) as { key: string };
		expect(key).toMatch(/^img\/[0-9a-f-]{36}\.png$/);
		const got = await app.fetch(`/files/${key}`);
		expect(got.headers.get("content-type")).toBe("image/png");
		expect(got.headers.get("content-disposition")).toBeNull();
		expect(new Uint8Array(await got.arrayBuffer())).toEqual(PNG);
	});

	it("refuses a file that only claims to be an image", async () => {
		await using app = cfnotes();
		const fake = new TextEncoder().encode("<script>alert(1)</script>");
		expect((await app.fetch("/files", upload(fake, "a.png", "image/png"))).status).toBe(415);
	});

	it("only ever downloads an attachment", async () => {
		await using app = cfnotes();
		const page = new TextEncoder().encode("<h1>hi</h1>");
		const res = await app.fetch("/files/attach", upload(page, "a.html", "text/html"));
		const { key } = (await res.json()) as { key: string };
		const got = await app.fetch(`/files/${key}?name=a%22%0Ab.html`);
		expect(got.headers.get("content-disposition")).toBe('attachment; filename="a_b.html"');
		expect(got.headers.get("x-content-type-options")).toBe("nosniff");
	});

	it("stores media as what its bytes prove, and answers byte ranges", async () => {
		await using app = cfnotes();
		const mp4 = new Uint8Array([
			0,
			0,
			0,
			0x18,
			...new TextEncoder().encode("ftypisom"),
			9,
			8,
			7,
			6,
			5,
		]);
		const res = await app.fetch("/files/media", upload(mp4, "clip.mov", "video/quicktime"));
		expect(res.status).toBe(201);
		const { key, type } = (await res.json()) as { key: string; type: string };
		expect([key.replace(/[0-9a-f-]{36}/, "*"), type]).toEqual(["media/*.mp4", "video/mp4"]);
		const whole = await app.fetch(`/files/${key}`);
		expect(whole.headers.get("accept-ranges")).toBe("bytes");
		expect(whole.headers.get("content-disposition")).toBeNull();
		expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
		const part = await app.fetch(`/files/${key}`, { headers: { range: "bytes=4-7" } });
		expect(part.status).toBe(206);
		expect(part.headers.get("content-range")).toBe(`bytes 4-7/${mp4.length}`);
		expect(await part.text()).toBe("ftyp");
		const past = await app.fetch(`/files/${key}`, { headers: { range: "bytes=999-" } });
		expect(past.status).toBe(416);
	});

	it("refuses media it can't recognise", async () => {
		await using app = cfnotes();
		const page = new TextEncoder().encode("<html><script>alert(1)</script>");
		expect((await app.fetch("/files/media", upload(page, "a.mp4", "video/mp4"))).status).toBe(415);
	});

	it("serves nothing outside its folders", async () => {
		await using app = cfnotes();
		expect((await app.fetch("/files/other/secret")).status).toBe(404);
	});
});
