import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

import { idIn, mcp, type Json } from "./testing.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP3 = new Uint8Array([...new TextEncoder().encode("ID3"), 4, 0, 0, 0, 0, 0, 1]);
const TEXT = new TextEncoder().encode("Just notes.");
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe("uploading files over the API", () => {
	it("stores images, media and attachments by their bytes, with the Markdown that shows them", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		const image = (await call("upload_file", { data: base64(PNG), name: "Logo" })).data;
		expect(image).toMatchObject({ kind: "image", type: "image/png", size: PNG.length });
		expect(image.path).toMatch(/^\/files\/img\/[\w-]+\.png$/);
		expect(image.url).toBe(`http://localhost:1337/api/v1${image.path}`);
		expect(image.markdown).toBe(`![Logo](${image.path})`);
		const song = (
			await call("upload_file", { data: `data:audio/mpeg;base64,${base64(MP3)}`, name: "Song" })
		).data;
		expect(song).toMatchObject({ kind: "audio", type: "audio/mpeg" });
		expect(song.markdown).toBe(`[Song](${song.path})`);
		const notes = (await call("upload_file", { data: base64(TEXT), name: "notes [v1].txt" })).data;
		expect(notes).toMatchObject({ kind: "attachment", type: "application/octet-stream" });
		expect(notes.markdown).toBe(`[notes \\[v1\\].txt](${notes.path})`);
		// An image kept as a download.
		const kept = (await call("upload_file", { data: base64(PNG), attachment: true })).data;
		expect(kept).toMatchObject({ kind: "attachment", markdown: `[Download](${kept.path})` });

		// Written into a page, they're the blocks the editor makes, and read back the same.
		const markdown = [image.markdown, song.markdown, notes.markdown].join("\n\n");
		const id = idIn((await call("create_page", { title: "Files", markdown })).text);
		const token = await app.token("read");
		const page = (await (await app.api(token, `/api/v1/pages/${id}`)).json()) as Json;
		expect(page.content).toContain('<img src="');
		expect(page.content).toContain('<figure class="audio"><audio controls');
		expect(page.content).toContain('<p class="file"><a href="');
		const read = (await call("read_page", { page_id: id })).structured!.markdown as string;
		expect(read).toMatch(/^\[Song\]\(\S*\/files\/media\/[\w-]+\.mp3\)$/m);
		await call("update_page", { page_id: id, markdown: read });
		const again = (await (await app.api(token, `/api/v1/pages/${id}`)).json()) as Json;
		expect(again.content).toBe(page.content);
		const served = await app.api(token, image.url.replace("http://localhost:1337", ""));
		expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
		expect((await call("update_page", { page_id: id, cover: image.path })).error).toBe(false);
	});

	it("refuses what it can't store", async () => {
		await using app = cfnotes();
		const call = await mcp(app);
		expect((await call("upload_file", { data: "not base64!" })).text).toBe(
			"BadRequest: data isn't base64",
		);
		expect((await call("upload_file", { data: "" })).text).toBe("BadRequest: The file is empty");
		// A friend who may only view can't upload.
		const { path, id } = await app.open();
		await app.post(path, "share", { op: "invite", kind: "page", id, email: "v@example.com" });
		const viewer = await mcp(app, "v@example.com");
		expect((await viewer("upload_file", { data: base64(PNG) })).text).toMatch(/^Forbidden/);
	});

	it("takes a multipart upload over REST", async () => {
		await using app = cfnotes();
		const token = await app.token("write");
		const body = new FormData();
		body.append("file", new File([MP3], "song.mp3", { type: "text/html" }));
		const res = await app.api(token, "/api/v1/files", { method: "POST", body });
		expect(res.status).toBe(201);
		// Its type comes from its bytes, not what was claimed.
		expect(await res.json()).toMatchObject({ kind: "audio", type: "audio/mpeg" });
		const read = await app.token("read");
		const refused = await app.api(read, "/api/v1/files", { method: "POST", body });
		expect(refused.status).toBe(403);
	});
});
