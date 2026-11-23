import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

const paragraph = (text: string) => ({
	type: "paragraph",
	version: 1,
	children: [{ type: "text", version: 1, text }],
});

describe("synced blocks", () => {
	it("keeps a block's latest content for every page that asks", async () => {
		await using app = cfnotes();
		const first = await app.open();
		const second = await app.open();
		const id = crypto.randomUUID();
		const op = async (path: string, body: object) =>
			(await app.post(path, "synced", body)).json() as Promise<Record<string, unknown>>;

		expect(await op(first.path, { op: "get", ids: [id] })).toEqual({ blocks: {} });
		expect(await op(first.path, { op: "save", id, content: [paragraph("v1")] })).toEqual({
			ok: true,
		});
		await op(second.path, { op: "save", id, content: [paragraph("v2")] });
		expect(await op(first.path, { op: "get", ids: [id] })).toEqual({
			blocks: { [id]: [paragraph("v2")] },
		});
	});

	it("refuses what isn't a block's content", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const status = async (body: object) => (await app.post(path, "synced", body)).status;
		const id = crypto.randomUUID();
		expect(await status({ op: "save", id, content: "<p>hi</p>" })).toBe(400);
		expect(await status({ op: "save", id, content: [{ text: "no type" }] })).toBe(400);
		expect(await status({ op: "save", id: "../x", content: [] })).toBe(400);
		expect(await status({ op: "get", ids: ["nope"] })).toBe(400);
		const huge = [paragraph("x".repeat(600_000))];
		expect(await status({ op: "save", id, content: huge })).not.toBe(200);
	});
});
