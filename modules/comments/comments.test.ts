import { describe, expect, it } from "vitest";

import { cfnotes, cookiesOf } from "#lib/testing.ts";

import { cleanQuote, MAX_QUOTE, type Thread } from "./comments.ts";

type Answer = { threads: Thread[] };

describe("comments", () => {
	it("starts threads, replies, edits, resolves and reopens them", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const op = async (body: object) => {
			const res = await app.post(path, "comments", body);
			expect(res.status).toBe(200);
			return ((await res.json()) as Answer).threads;
		};
		const inline = crypto.randomUUID();
		const onPage = crypto.randomUUID();

		expect(await op({ op: "list" })).toEqual([]);
		await op({ op: "start", thread: inline, quote: "  some\n text ", body: " Is this right? " });
		await op({ op: "start", thread: onPage, quote: null, body: "Whole page" });
		let threads = await op({ op: "reply", thread: inline, body: "Yes\r\nit is" });
		expect(threads.map((t) => [t.id, t.quote])).toEqual([
			[inline, "some text"],
			[onPage, null],
		]);
		expect(threads[0]!.comments.map((c) => [c.body, c.author])).toEqual([
			["Is this right?", "owner@example.com"],
			["Yes\nit is", "owner@example.com"],
		]);

		const first = threads[0]!.comments[0]!;
		threads = await op({ op: "edit", comment: first.id, body: "Is this right?!" });
		expect(threads[0]!.comments[0]).toMatchObject({ body: "Is this right?!" });
		expect(threads[0]!.comments[0]!.editedAt).toBeTypeOf("number");

		threads = await op({ op: "resolve", thread: inline });
		expect(threads[0]).toMatchObject({ resolvedBy: "owner@example.com" });
		threads = await op({ op: "resolve", thread: inline, resolved: false });
		expect(threads[0]).toMatchObject({ resolvedAt: null, resolvedBy: null });
	});

	it("deletes a thread with its last comment", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const thread = crypto.randomUUID();
		const op = async (body: object) =>
			((await (await app.post(path, "comments", body)).json()) as Answer).threads;
		let threads = await op({ op: "start", thread, quote: "x", body: "one" });
		threads = await op({ op: "reply", thread, body: "two" });
		const [one, two] = threads[0]!.comments;
		threads = await op({ op: "delete", comment: one!.id });
		expect(threads[0]!.comments.map((c) => c.body)).toEqual(["two"]);
		expect(await op({ op: "delete", comment: two!.id })).toEqual([]);
	});

	it("lets only a comment's author change it", async () => {
		await using app = cfnotes({ ALLOWED_EMAILS: "owner@example.com, editor@example.com" });
		const { path } = await app.open();
		const thread = crypto.randomUUID();
		await app.post(path, "comments", { op: "start", thread, quote: null, body: "mine" });
		const [comment] = ((await (await app.post(path, "comments", { op: "list" })).json()) as Answer)
			.threads[0]!.comments;

		app.google.profile = { sub: "2", email: "editor@example.com", email_verified: true };
		const cookie = cookiesOf(await app.signIn());
		const asEditor = (body: object) =>
			app.fetch(`${path}?__action=comments`, {
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify(body),
			});
		expect((await asEditor({ op: "edit", comment: comment!.id, body: "theirs" })).status).toBe(403);
		expect((await asEditor({ op: "delete", comment: comment!.id })).status).toBe(403);
		// Replying and resolving are for everyone.
		expect((await asEditor({ op: "reply", thread, body: "a reply" })).status).toBe(200);
		const res = await asEditor({ op: "resolve", thread });
		const [resolved] = ((await res.json()) as Answer).threads;
		expect(resolved).toMatchObject({ resolvedBy: "editor@example.com" });
		expect(resolved!.comments.map((c) => c.author)).toEqual([
			"owner@example.com",
			"editor@example.com",
		]);
	});

	it("refuses what isn't a comment, and threads of other pages", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const other = (await (await app.post(path, "linkPage", { title: "Other" })).json()) as {
			id: string;
		};
		const status = async (body: object, on = path) => (await app.post(on, "comments", body)).status;
		const thread = crypto.randomUUID();
		expect(await status({ op: "start", thread, body: "   " })).toBe(400);
		expect(await status({ op: "start", thread, body: "x".repeat(10_001) })).toBe(400);
		expect(await status({ op: "start", thread: "../x", body: "hi" })).toBe(400);
		expect(await status({ op: "start", thread, body: "hi" })).toBe(200);
		expect(await status({ op: "start", thread, body: "again" })).toBe(400);
		expect(await status({ op: "reply", thread: crypto.randomUUID(), body: "hi" })).toBe(404);
		expect(await status({ op: "reply", thread, body: "hi" }, `/p/${other.id}`)).toBe(404);
		expect(await status({ op: "resolve", thread }, `/p/${other.id}`)).toBe(404);
	});

	it("keeps quotes short and on one line", () => {
		expect(cleanQuote(" a\n\tb ")).toBe("a b");
		expect(cleanQuote("   ")).toBeNull();
		expect(cleanQuote(null)).toBeNull();
		const long = cleanQuote("word ".repeat(200))!;
		expect(long.length).toBeLessThanOrEqual(MAX_QUOTE);
		expect(long.endsWith("…")).toBe(true);
	});

	it("reacts to a comment, again takes it back, and goes with the comment", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const thread = crypto.randomUUID();
		const op = async (body: object) => {
			const res = await app.post(path, "comments", body);
			return { status: res.status, threads: res.ok ? ((await res.json()) as Answer).threads : [] };
		};
		await op({ op: "start", thread, quote: null, body: "Lunch?" });
		const { threads } = await op({ op: "reply", thread, body: "Yes" });
		const [first, second] = threads[0]!.comments;
		expect(first!.reactions).toEqual([]);

		let after = await op({ op: "react", comment: first!.id, emoji: "👍" });
		await op({ op: "react", comment: first!.id, emoji: "🎉" });
		after = await op({ op: "list" });
		expect(after.threads[0]!.comments[0]!.reactions).toEqual([
			{ emoji: "👍", people: ["owner@example.com"] },
			{ emoji: "🎉", people: ["owner@example.com"] },
		]);
		after = await op({ op: "react", comment: first!.id, emoji: "👍" });
		expect(after.threads[0]!.comments[0]!.reactions).toEqual([
			{ emoji: "🎉", people: ["owner@example.com"] },
		]);
		expect((await op({ op: "react", comment: first!.id, emoji: "🦄" })).status).toBe(400);
		expect((await op({ op: "react", comment: crypto.randomUUID(), emoji: "👍" })).status).toBe(404);

		// Deleting it takes its reactions; the other comment keeps its own.
		await op({ op: "react", comment: second!.id, emoji: "👀" });
		after = await op({ op: "delete", comment: first!.id });
		expect(after.threads[0]!.comments.map((c) => c.reactions)).toEqual([
			[{ emoji: "👀", people: ["owner@example.com"] }],
		]);
	});

	it("keeps Markdown, and a page it links to lists the commented page", async () => {
		await using app = cfnotes();
		const { path } = await app.open();
		const made = (await (await app.post(path, "linkPage", { title: "Target" })).json()) as {
			id: string;
		};
		const body = `**Look** at [Target](/p/${made.id}), [@friend](mailto:friend@example.com)`;
		const res = await app.post(path, "comments", {
			op: "start",
			thread: crypto.randomUUID(),
			quote: null,
			body,
		});
		const { threads } = (await res.json()) as Answer;
		expect(threads[0]!.comments[0]!.body).toBe(body);
		const target = await (await app.fetch(`/p/${made.id}`)).text();
		expect(target).toContain("Linked from 1");
	});

	it("offers the page's owners and the people it's shared with to mention", async () => {
		await using app = cfnotes();
		const { path, id } = await app.open();
		await app.post(path, "share", {
			op: "invite",
			kind: "page",
			id,
			email: "friend@example.com",
		});
		const html = await (await app.fetch(path)).text();
		expect(html).toContain(
			`data-people="${JSON.stringify(["owner@example.com", "friend@example.com"]).replace(/"/g, "&quot;")}"`,
		);
	});
});
