import { describe, expect, it } from "vitest";

import { atLeast, roleOfRank, sharedTree } from "./roles.ts";

describe("atLeast", () => {
	it("orders view, comment, edit and owner", () => {
		expect(atLeast("edit", "comment")).toBe(true);
		expect(atLeast("comment", "edit")).toBe(false);
		expect(atLeast("owner", "edit")).toBe(true);
		expect(atLeast(null, "view")).toBe(false);
		expect([1, 2, 3].map(roleOfRank)).toEqual(["view", "comment", "edit"]);
	});
});

describe("sharedTree", () => {
	const folders = [
		{ id: "a", parent_id: null, name: "A" },
		{ id: "b", parent_id: "a", name: "B" },
		{ id: "c", parent_id: "b", name: "C" },
		{ id: "x", parent_id: null, name: "X" },
	];
	const pages = [
		{ id: "p1", folder_id: "c", title: "In C" },
		{ id: "p2", folder_id: "x", title: "In X" },
		{ id: "p3", folder_id: "x", title: "Shared alone" },
	];

	it("takes a shared folder with everything under it, at the top level", () => {
		const tree = sharedTree({
			shares: [{ target_kind: "folder", target_id: "b" }],
			folders,
			pages,
			direct: [],
		});
		expect(tree.folders).toEqual([
			{ id: "b", parent_id: null, name: "B" },
			{ id: "c", parent_id: "b", name: "C" },
		]);
		expect(tree.pages.map((p) => p.id)).toEqual(["p1"]);
	});

	it("puts a page shared on its own at the top level, once", () => {
		const tree = sharedTree({
			shares: [
				{ target_kind: "folder", target_id: "a" },
				{ target_kind: "folder", target_id: "gone" },
			],
			folders,
			pages,
			direct: [pages[2]!, pages[0]!],
		});
		expect(tree.pages).toEqual([pages[0], { ...pages[2], folder_id: null }]);
		expect(tree.folders.map((f) => f.id)).toEqual(["a", "b", "c"]);
	});
});
