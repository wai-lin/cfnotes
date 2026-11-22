import { describe, expect, it } from "vite-plus/test";

import { patchElements, patchSignals, readSignals, sse } from "./datastar";

const req = (body: string) => ({ json: async <T>() => JSON.parse(body) as T });

describe("readSignals", () => {
	it("reads Datastar's flat signal body", async () => {
		expect(await readSignals(req('{"title":"Hi"}'))).toEqual({ title: "Hi" });
	});

	it("also accepts signals nested under `datastar`", async () => {
		expect(await readSignals(req('{"datastar":{"title":"Hi"}}'))).toEqual({ title: "Hi" });
	});

	it("returns an empty record for invalid or non-object bodies", async () => {
		expect(await readSignals(req("not json"))).toEqual({});
		expect(await readSignals(req("42"))).toEqual({});
	});
});

describe("SSE events", () => {
	it("prefixes every markup line with `data: elements`", () => {
		expect(patchElements("<a id=x>\n1</a>")).toBe(
			"event: datastar-patch-elements\ndata: elements <a id=x>\ndata: elements 1</a>\n\n",
		);
	});

	it("accepts spacefn html output", () => {
		expect(patchElements({ value: "<p id=y></p>" })).toContain("data: elements <p id=y></p>");
	});

	it("serializes signal patches as JSON", () => {
		expect(patchSignals({ _saving: false })).toBe(
			'event: datastar-patch-signals\ndata: signals {"_saving":false}\n\n',
		);
	});

	it("wraps events in an event-stream response", async () => {
		const res = sse(patchSignals({ a: 1 }));
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(await res.text()).toContain("signals {");
	});
});
