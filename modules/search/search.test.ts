import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

interface Found {
	results: { id: string; parent: string | null; href: string }[];
}

describe("/search", () => {
	// A page outside any database has no parent title: each of these queries must allow that null.
	it.each(["", "?q=started", "?in=trash", "?q=started&in=trash"])("answers %s", async (query) => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		const inTrash = query.includes("in=trash");
		if (inTrash) await app.post(path, "removePage", { id });
		const res = await app.fetch(`/search${query}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		const [found] = ((await res.json()) as Found).results;
		expect(found).toMatchObject({
			id,
			parent: null,
			href: inTrash ? `/trash#trash-${id}` : `/p/${id}`,
		});
	});

	it("names a row's database", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const { state } = (await (await app.post(path, "dbOp", { op: "create" })).json()) as {
			state: { id: string };
		};
		await app.post(path, "dbOp", { op: "rename", databaseId: state.id, title: "Tasks" });
		await app.post(path, "dbOp", { op: "addRow", databaseId: state.id, title: "Zebra" });
		const { results } = (await (await app.fetch("/search?q=zebra")).json()) as Found;
		expect(results[0]?.parent).toBe("Tasks");
	});
});
