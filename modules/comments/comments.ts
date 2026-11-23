/**
 * Comments: threads on a page, either on some of its text (the editor marks
 * that text with the thread's id) or on the whole page. Anyone signed in may
 * comment, reply and resolve; only a comment's author may edit or delete it.
 */
import { Clock, Effect, Option, Schema } from "effect";
import { BadRequest, Forbidden, NotFound } from "spacefn";

import { isId } from "#lib/ids.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import MainDb from "#space/db/main.ts";

/** Longest comment, in characters. */
export const MAX_BODY = 10_000;
/** Longest quote kept for an inline thread; the rest is cut with an ellipsis. */
export const MAX_QUOTE = 300;

export interface Comment {
	id: string;
	body: string;
	author: string | null;
	createdAt: number;
	editedAt: number | null;
}

export interface Thread {
	id: string;
	/** The text it's on, or `null` for a comment on the whole page. */
	quote: string | null;
	createdAt: number;
	resolvedAt: number | null;
	resolvedBy: string | null;
	comments: Comment[];
}

/**
 * `start` a thread (its id comes from the browser, which marks the text with
 * it first), `reply` to one, `edit` or `delete` a comment, `resolve` (or with
 * `resolved: false` reopen) a thread, or just `list` them. Every op answers
 * with the page's threads.
 */
export const Op = Schema.Struct({
	op: Schema.Literals(["list", "start", "reply", "edit", "delete", "resolve"]),
	thread: Schema.optional(Schema.String),
	comment: Schema.optional(Schema.String),
	quote: Schema.optional(Schema.NullOr(Schema.String)),
	body: Schema.optional(Schema.String),
	resolved: Schema.optional(Schema.Boolean),
});

const bad = (message: string) => new BadRequest({ message });

/** A comment's text, trimmed, or why it can't be one. */
const cleanBody = (body: string | undefined) => {
	const text = (body ?? "").replace(/\r\n?/g, "\n").trim();
	if (text === "") return Effect.fail(bad("empty_comment"));
	if (text.length > MAX_BODY) return Effect.fail(bad("comment_too_long"));
	return Effect.succeed(text);
};

/** The quoted text on one line, cut to `MAX_QUOTE`. */
export const cleanQuote = (quote: string | null | undefined): string | null => {
	const text = (quote ?? "").replace(/\s+/g, " ").trim();
	if (text === "") return null;
	return text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1).trimEnd()}…` : text;
};

/** The page's threads, oldest first, each with its comments. */
export const threads = Effect.fn("Comments.threads")(function* (pageId: string) {
	const found = yield* MainDb.listCommentThreads({ pageId });
	const comments = yield* MainDb.listComments({ pageId });
	const byThread = new Map<string, Comment[]>();
	for (const row of comments) {
		const list = byThread.get(row.thread_id) ?? [];
		list.push({
			id: row.id,
			body: row.body,
			author: row.author,
			createdAt: row.created_at,
			editedAt: row.edited_at,
		});
		byThread.set(row.thread_id, list);
	}
	return found.map((row): Thread => ({
		id: row.id,
		quote: row.quote,
		createdAt: row.created_at,
		resolvedAt: row.resolved_at,
		resolvedBy: row.resolved_by,
		comments: byThread.get(row.id) ?? [],
	}));
});

/** A thread of this page, or a 404. */
const threadOn = Effect.fn("Comments.threadOn")(function* (pageId: string, id: unknown) {
	if (!isId(id)) return yield* bad("invalid_thread");
	const thread = Option.getOrUndefined(yield* MainDb.findCommentThread({ id }));
	if (!thread || thread.page_id !== pageId)
		return yield* new NotFound({ message: "No such thread" });
	return thread;
});

/** A comment on this page that the signed-in person wrote, or why not. */
const ownComment = Effect.fn("Comments.ownComment")(function* (pageId: string, id: unknown) {
	if (!isId(id)) return yield* bad("invalid_comment");
	const comment = Option.getOrUndefined(yield* MainDb.findComment({ id }));
	if (!comment || comment.page_id !== pageId)
		return yield* new NotFound({ message: "No such comment" });
	const me = yield* Sessions.editor;
	if (comment.author !== null && comment.author !== me)
		return yield* new Forbidden({ message: "Only its author can change a comment" });
	return comment;
});

/** Runs one op on page `pageId`'s comments; answers `{threads}`. */
export const run = Effect.fn("Comments.run")(function* (pageId: string, body: typeof Op.Type) {
	const page = Option.getOrUndefined(yield* MainDb.findPage({ id: pageId }));
	if (!page || page.archived_at !== null) return yield* new NotFound({ message: "No such page" });
	const now = yield* Clock.currentTimeMillis;
	const by = yield* Sessions.editor;

	switch (body.op) {
		case "list":
			break;
		case "start": {
			if (!isId(body.thread)) return yield* bad("invalid_thread");
			const text = yield* cleanBody(body.body);
			if (Option.isSome(yield* MainDb.findCommentThread({ id: body.thread })))
				return yield* bad("thread_exists");
			yield* MainDb.createCommentThread({
				id: body.thread,
				pageId,
				quote: cleanQuote(body.quote),
				now,
				by,
			});
			yield* MainDb.addComment({
				id: crypto.randomUUID(),
				threadId: body.thread,
				body: text,
				now,
				by,
			});
			break;
		}
		case "reply": {
			const thread = yield* threadOn(pageId, body.thread);
			const text = yield* cleanBody(body.body);
			yield* MainDb.addComment({
				id: crypto.randomUUID(),
				threadId: thread.id,
				body: text,
				now,
				by,
			});
			break;
		}
		case "edit": {
			const comment = yield* ownComment(pageId, body.comment);
			yield* MainDb.editComment({ id: comment.id, body: yield* cleanBody(body.body), now });
			break;
		}
		case "delete": {
			const comment = yield* ownComment(pageId, body.comment);
			yield* MainDb.deleteComment({ id: comment.id });
			yield* MainDb.deleteEmptyCommentThread({ id: comment.thread_id });
			break;
		}
		case "resolve": {
			const thread = yield* threadOn(pageId, body.thread);
			const resolved = body.resolved ?? true;
			yield* MainDb.resolveCommentThread({
				id: thread.id,
				at: resolved ? now : null,
				by: resolved ? by : null,
			});
			break;
		}
	}
	return { threads: yield* threads(pageId) };
});

/** Deletes every comment on these pages (when they are deleted for good). */
export const forget = Effect.fn("Comments.forget")(function* (ids: string) {
	yield* MainDb.forgetPagesComments({ ids });
	yield* MainDb.forgetPagesCommentThreads({ ids });
});
