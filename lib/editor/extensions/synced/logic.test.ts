import { describe, expect, it } from "vitest";

import { editedCopy, onLoaded, reconcile, syncedIn, type JsonNode } from "./logic.ts";

const p = (text: string): JsonNode => ({ type: "paragraph", children: [{ type: "text", text }] });
const synced = (syncId: string, ...children: JsonNode[]): JsonNode => ({
	type: "synced",
	syncId,
	children,
});

describe("synced blocks", () => {
	it("finds every copy, in columns too, but not inside another synced block", () => {
		const root: JsonNode = {
			type: "root",
			children: [
				synced("a", p("one"), synced("b", p("nested"))),
				{ type: "columns", children: [{ type: "column", children: [synced("a", p("two"))] }] },
			],
		};
		const found = syncedIn(root);
		expect([...found.keys()]).toEqual(["a"]);
		expect(found.get("a")!.map((c) => JSON.parse(c)[0].children[0].text)).toEqual(["one", "two"]);
	});

	it("takes the copy that changed as the new content", () => {
		expect(editedCopy(["x", "y", "x"], "x")).toBe("y");
		expect(editedCopy(["x", "x"], "x")).toBeNull();
	});

	it("shows the server's content on load, unless the page changed meanwhile", () => {
		expect(onLoaded("server", "page", "page")).toEqual({ show: "server", save: null });
		expect(onLoaded("same", "same", "same")).toEqual({ show: null, save: null });
		expect(onLoaded("server", "page", "typed")).toEqual({ show: null, save: "typed" });
		expect(onLoaded(undefined, "page", "page")).toEqual({ show: null, save: "page" });
	});

	it("gives a pasted copy the current content, even when it's old", () => {
		const copy = (json: string, fresh = false) => ({ json, fresh });
		expect(reconcile([copy("new"), copy("old", true)], "new")).toEqual({
			content: "new",
			save: false,
			redraw: true,
		});
		// An edit to a copy that was there wins, and the pasted one follows it.
		expect(reconcile([copy("typed"), copy("old", true)], "new")).toEqual({
			content: "typed",
			save: true,
			redraw: true,
		});
		expect(reconcile([copy("new"), copy("new")], "new")).toEqual({
			content: "new",
			save: false,
			redraw: false,
		});
	});
});
