import { describe, expect, it } from "vitest";

import { isRead, parseKey, queueKey, signalsEvent } from "./queue.ts";

const ORIGIN = "https://notes.test";
const PAGE = "/p/0b8a9a3e-8d5e-4f7e-9c51-2a4c8f1d3e70";
const at = (path: string) => new URL(path, ORIGIN);

describe("the offline queue", () => {
	it("keeps only text edits to pages", () => {
		expect(queueKey(at(`${PAGE}?__action=save`), "POST", ORIGIN)).toBe(`${PAGE}?__action=save`);
		expect(queueKey(at(`${PAGE}?__action=title&x=1`), "post", ORIGIN)).toBe(
			`${PAGE}?__action=title`,
		);
		expect(queueKey(at(`${PAGE}?__action=dbOp`), "POST", ORIGIN)).toBeNull();
		expect(queueKey(at(`${PAGE}?__action=save`), "GET", ORIGIN)).toBeNull();
		expect(queueKey(at("/trash?__action=save"), "POST", ORIGIN)).toBeNull();
		expect(queueKey(new URL(`https://evil.test${PAGE}?__action=save`), "POST", ORIGIN)).toBeNull();
	});

	it("tells reads that are posted from changes", () => {
		expect(isRead(at(`${PAGE}?__action=synced`), '{"op":"get","ids":[]}')).toBe(true);
		expect(isRead(at(`${PAGE}?__action=comments`), '{"op":"list"}')).toBe(true);
		expect(isRead(at(`${PAGE}?__action=comments`), '{"op":"reply"}')).toBe(false);
		expect(isRead(at(`${PAGE}?__action=dbOp`), "not json")).toBe(false);
	});

	it("reads its keys back", () => {
		expect(parseKey(`${PAGE}?__action=title`)).toEqual({ path: PAGE, action: "title" });
	});

	it("answers a queued Datastar save with signals", () => {
		expect(signalsEvent({ _saving: false })).toBe(
			'event: datastar-patch-signals\ndata: signals {"_saving":false}\n\n',
		);
	});
});
