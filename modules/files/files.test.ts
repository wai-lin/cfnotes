import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const upload = (bytes: Uint8Array<ArrayBuffer>, name: string, type: string) => {
	const body = new FormData();
	body.append("file", new File([bytes], name, { type }));
	return { method: "POST", body };
};

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

	it("serves nothing outside its two folders", async () => {
		await using app = cfnotes();
		expect((await app.fetch("/files/other/secret")).status).toBe(404);
	});
});
