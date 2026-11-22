import { describe, expect, it } from "vitest";

import { placeBefore } from "#lib/order.ts";

import {
	buildTree,
	cleanFolderName,
	folderPath,
	isWithin,
	type FolderRow,
	type PageRow,
} from "./tree.ts";

const f = (id: string, parent_id: string | null = null): FolderRow => ({ id, parent_id, name: id });
const p = (id: string, folder_id: string | null = null): PageRow => ({ id, folder_id, title: id });

describe("buildTree", () => {
	it("nests folders and pages, keeping order", () => {
		const tree = buildTree(
			[f("a"), f("b", "a"), f("c")],
			[p("1"), p("2", "b"), p("3", "a"), p("4", "b")],
		);
		expect(tree.folders.map((n) => n.folder.id)).toEqual(["a", "c"]);
		expect(tree.pages.map((x) => x.id)).toEqual(["1"]);
		const a = tree.folders[0]!;
		expect(a.pages.map((x) => x.id)).toEqual(["3"]);
		expect(a.folders[0]!.pages.map((x) => x.id)).toEqual(["2", "4"]);
	});

	it("puts rows with a missing folder at the top level", () => {
		const tree = buildTree([f("a", "gone")], [p("1", "gone")]);
		expect(tree.folders.map((n) => n.folder.id)).toEqual(["a"]);
		expect(tree.pages.map((x) => x.id)).toEqual(["1"]);
	});

	it("breaks parent cycles instead of losing folders", () => {
		const tree = buildTree([f("a", "b"), f("b", "a")], []);
		const ids = (nodes: typeof tree.folders): string[] =>
			nodes.flatMap((n) => [n.folder.id, ...ids(n.folders)]);
		expect(ids(tree.folders).sort()).toEqual(["a", "b"]);
	});
});

describe("folderPath / isWithin", () => {
	const folders = [f("a"), f("b", "a"), f("c", "b"), f("d")];

	it("lists the folder and its ancestors", () => {
		expect(folderPath(folders, "c")).toEqual(["c", "b", "a"]);
		expect(folderPath(folders, null)).toEqual([]);
		expect(folderPath(folders, "missing")).toEqual([]);
	});

	it("detects moves into a folder's own subtree", () => {
		expect(isWithin(folders, "c", "a")).toBe(true);
		expect(isWithin(folders, "a", "a")).toBe(true);
		expect(isWithin(folders, "d", "a")).toBe(false);
		expect(isWithin(folders, null, "a")).toBe(false);
	});
});

describe("cleanFolderName", () => {
	it("trims, collapses and rejects empty names", () => {
		expect(cleanFolderName("  Work   notes ")).toBe("Work notes");
		expect(cleanFolderName("   ")).toBeNull();
		expect(cleanFolderName(42)).toBeNull();
		expect(cleanFolderName("x".repeat(300))).toHaveLength(100);
	});
});

describe("placeBefore", () => {
	const ids = ["a", "b", "c", "d"];

	it("moves a page up or down within its folder", () => {
		expect(placeBefore(ids, "d", "a")).toEqual(["d", "a", "b", "c"]);
		expect(placeBefore(ids, "a", "d")).toEqual(["b", "c", "a", "d"]);
		expect(placeBefore(ids, "b", null)).toEqual(["a", "c", "d", "b"]);
	});

	it("inserts a page coming from another folder", () => {
		expect(placeBefore(ids, "x", "c")).toEqual(["a", "b", "x", "c", "d"]);
		expect(placeBefore([], "x", null)).toEqual(["x"]);
	});

	it("rejects targets outside the folder", () => {
		expect(placeBefore(ids, "a", "zzz")).toBeNull();
		expect(placeBefore(ids, "a", "a")).toBeNull();
	});
});
