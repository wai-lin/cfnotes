/** MCP tools for finding, reading and writing pages, and commenting on them. */
import { Effect } from "effect";

import { REACTIONS } from "#modules/comments/reactions.ts";

import * as Api from "../api.ts";
import * as Sections from "../sections.ts";
import {
	boolean,
	adds,
	array,
	changes,
	integer,
	json,
	MARKDOWN_LINKS,
	object,
	pageId,
	readOnly,
	record,
	rich,
	str,
	string,
	type Json,
	type Tool,
} from "./tool.ts";

const markdown = string("Content as Markdown.");
export const properties: Json = {
	type: "object",
	description:
		'Database row properties by name, e.g. {"Status": "Draft", "Tags": ["news"], "Date": "2026-11-23"}.',
	additionalProperties: true,
};

/** The page as an agent reads it: what it is, then its content; and all of that as data. */
export const pageText = (
	page: Effect.Success<ReturnType<typeof Api.getPage>>,
	threads: unknown[],
) => {
	const meta: Json = {
		id: page.id,
		kind: page.kind,
		url: page.url,
		updatedAt: page.updatedAt,
		updatedBy: page.updatedBy,
		...(page.database ? { database: page.database } : {}),
		...(page.properties ? { properties: page.properties } : {}),
		...(page.folderId ? { folderId: page.folderId } : {}),
		...(page.cover ? { cover: page.cover } : {}),
		...(page.backlinks.length > 0 ? { linkedFrom: page.backlinks } : {}),
		...(page.lock ? { lockedBy: page.lock } : {}),
		access: page.access,
		people: page.people,
	};
	const parts = [
		`# ${page.icon ? `${page.icon} ` : ""}${page.title || "Untitled"}`,
		"```json\n" + json(meta) + "\n```",
		String(page.content || "_(empty)_"),
	];
	if (threads.length > 0) parts.push(`## Comments\n\n\`\`\`json\n${json(threads)}\n\`\`\``);
	return rich(parts.join("\n\n"), {
		...meta,
		title: page.title,
		icon: page.icon,
		markdown: String(page.content ?? ""),
		comments: threads,
	});
};

/** A tool's limit and offset. */
const paging = (args: Record<string, unknown>) => ({
	limit: typeof args.limit === "number" ? args.limit : undefined,
	offset: typeof args.offset === "number" ? args.offset : undefined,
});

/** A page as it is now, after a change. */
export const pageNow = (id: string) =>
	Effect.map(Api.getPage(id, MARKDOWN_LINKS), (page) => pageText(page, []));

const heading = {
	heading: string('A top-level heading\'s text; "## Text" also matches its level.'),
	occurrence: { type: "integer", minimum: 1, description: "Which one, when several say the same." },
};
const edit = (
	action: string,
	description: string,
	fields: Record<string, unknown>,
	required: string[],
) => ({
	...object({ action: { const: action }, ...fields }, ["action", ...required]),
	description,
});
const pageEdit = {
	oneOf: [
		edit(
			"replace_section",
			"Replaces what's under a heading (up to the next heading of its level or higher); the heading stays.",
			{ ...heading, markdown },
			["heading", "markdown"],
		),
		edit("append_to_section", "Adds to the end of a heading's section.", { ...heading, markdown }, [
			"heading",
			"markdown",
		]),
		edit(
			"insert_after",
			"Adds right below a heading, before the rest of its section.",
			{ ...heading, markdown },
			["heading", "markdown"],
		),
		edit("insert_before", "Adds just above a heading.", { ...heading, markdown }, [
			"heading",
			"markdown",
		]),
		edit("delete_section", "Deletes a heading and its section.", heading, ["heading"]),
		edit(
			"replace_text",
			"Finds and replaces text, keeping its formatting. Without all, it must match exactly once.",
			{
				find: string("The text to find (case-sensitive, within one run of formatting)."),
				replace: string("What to put instead."),
				all: { type: "boolean", description: "Replace every match." },
			},
			["find", "replace"],
		),
	],
};

export const PAGE_TOOLS: Tool[] = [
	{
		name: "search",
		title: "Search pages",
		description:
			"Finds pages, databases and rows by words in their title or text, best first; every word must appear. An empty query lists the most recently edited. Pages through the matches with limit and offset (nextOffset is where the next page starts).",
		inputSchema: object(
			{
				query: string("Words to find."),
				limit: integer("At most this many (20 if unset).", 1, 200),
				offset: integer("Skip this many first."),
			},
			["query"],
		),
		annotations: readOnly,
		run: (args) => Api.search(str(args.query) ?? "", paging(args)),
	},
	{
		name: "list_pages",
		title: "List pages",
		description:
			"Lists pages not in Trash, with their id, kind (page, database or row), folder and when they changed, most recently created last. Filter by kind, database or folder; page through with limit and offset (nextOffset is where the next page starts).",
		inputSchema: object({
			kind: { type: "string", enum: ["page", "database", "row"] },
			database_id: string("Only the rows of this database."),
			folder_id: {
				type: ["string", "null"],
				description: "Only what's in this folder (not its subfolders); null for the top level.",
			},
			limit: integer("At most this many (200 if unset).", 1, 1000),
			offset: integer("Skip this many first."),
		}),
		annotations: readOnly,
		run: (args) =>
			Effect.map(
				Api.listPages({ kind: str(args.kind), database: str(args.database_id) }),
				(pages) => {
					const inFolder =
						args.folder_id === undefined
							? pages
							: pages.filter(
									(p) =>
										(p.folder?.id ?? null) === (args.folder_id ?? null) &&
										(args.folder_id !== null || (p.kind !== "row" && !p.hostId)),
								);
					const { items, ...page } = Api.paged(inFolder, paging(args), 200);
					return {
						...page,
						pages: items.map(({ id, title, kind, icon, folder, databaseId, updatedAt }) => ({
							id,
							title,
							kind,
							icon,
							folder: folder?.path ?? null,
							databaseId,
							updatedAt,
						})),
					};
				},
			),
	},
	{
		name: "list_folders",
		title: "List folders",
		description: "Lists the folders, with their ids and paths, for putting new pages in.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Api.listFolders, (folders) => ({ folders })),
	},
	{
		name: "read_page",
		title: "Read a page",
		description:
			"Reads a page as Markdown: its title, properties (for a database row), cover, the pages linking to it (linkedFrom), what locks it (lockedBy), what the token may do on it (access: owner, edit, comment or view), who can be mentioned or set in a Person property (people, as emails), its content and comments.",
		inputSchema: object({ page_id: pageId }, ["page_id"]),
		annotations: readOnly,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				const page = yield* Api.getPage(id, MARKDOWN_LINKS);
				return pageText(page, yield* Api.pageComments(id));
			}),
	},
	{
		name: "create_page",
		title: "Create a page",
		description:
			"Makes a page with Markdown content: in a folder (or at the top level), or as a row of a database with properties. Answers with the new page.",
		inputSchema: object(
			{
				title: string("The page's title."),
				markdown,
				folder_id: string("A folder to put it in (see list_folders)."),
				database_id: string("A database to add it to, as a row."),
				properties,
				icon: string("An emoji."),
			},
			["title"],
		),
		annotations: adds,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = yield* Api.createPage({
					title: str(args.title),
					markdown: str(args.markdown),
					folder: str(args.folder_id),
					database: str(args.database_id),
					icon: str(args.icon),
					properties: record(args.properties),
				});
				return yield* pageNow(id);
			}),
	},
	{
		name: "update_page",
		title: "Change a page",
		description:
			"Changes a page's title, icon, cover or properties, replaces its content (markdown) or adds to its end (append_markdown). Answers with the page as it is now.",
		inputSchema: object(
			{
				page_id: pageId,
				title: string("A new title."),
				markdown: string("New content, replacing all of it."),
				append_markdown: string("Content to add at the end."),
				properties,
				icon: string("An emoji; empty to remove it."),
				cover: string(
					"g1 to g6 for a gradient, an uploaded image (its /files/img/… path or URL, e.g. from a files property), or empty to remove it.",
				),
				locked: boolean(
					"Owners only: true locks it (and, for a database, its rows) so the people it's shared with can read and comment but not change, move or delete it; false unlocks it.",
				),
			},
			["page_id"],
		),
		annotations: changes,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				yield* Api.updatePage(id, {
					title: str(args.title),
					markdown: str(args.markdown),
					append: str(args.append_markdown),
					icon: str(args.icon),
					cover: str(args.cover),
					properties: record(args.properties),
					locked: typeof args.locked === "boolean" ? args.locked : undefined,
				});
				return yield* pageNow(id);
			}),
	},
	{
		name: "edit_page",
		title: "Edit part of a page",
		description:
			"Changes part of a page's content without rewriting the rest: a heading's section (replace, add to, delete, or add before or after it), or find-and-replace in its text. Edits run in order and are saved together; if one fails, nothing is changed. Safer than update_page's markdown while someone has the page open. Answers with the page as it is now.",
		inputSchema: object({ page_id: pageId, edits: array(pageEdit, "What to change, in order.") }, [
			"page_id",
			"edits",
		]),
		annotations: changes,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				yield* Sections.editPage(id, args.edits);
				return yield* pageNow(id);
			}),
	},
	{
		name: "add_comment",
		title: "Comment on a page",
		description:
			"Adds a comment: on the whole page, on some of its text (quote, which gets highlighted as the editor does), or as a reply in one of its threads (see read_page). Answers with the thread.",
		inputSchema: object(
			{
				page_id: pageId,
				body: string(
					"The comment, as Markdown: [@name](mailto:email) mentions someone who can open the page, [Title](/p/<id>) links to a page or database.",
				),
				quote: string(
					"Text of the page to comment on, exactly as written (within one run of formatting, there once).",
				),
				thread_id: string("A thread to reply in."),
			},
			["page_id", "body"],
		),
		annotations: adds,
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				const thread = yield* Api.addComment(id, {
					body: str(args.body) ?? "",
					thread: str(args.thread_id),
					quote: str(args.quote),
				});
				return (yield* Api.pageComments(id)).find((t) => t.id === thread) ?? {};
			}),
	},
	{
		name: "resolve_thread",
		title: "Resolve a comment thread",
		description:
			"Resolves a page's comment thread, or reopens it (resolved: false). Answers with the thread.",
		inputSchema: object(
			{
				page_id: pageId,
				thread_id: string("The thread (see read_page)."),
				resolved: { type: "boolean", description: "false reopens it; true if unset." },
			},
			["page_id", "thread_id"],
		),
		annotations: { ...changes, destructiveHint: false, idempotentHint: true },
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				const thread = str(args.thread_id) ?? "";
				yield* Api.changeComment(id, { op: "resolve", thread, resolved: args.resolved !== false });
				return (yield* Api.pageComments(id)).find((t) => t.id === thread) ?? {};
			}),
	},
	{
		name: "edit_comment",
		title: "Edit a comment",
		description: "Changes the text of a comment the token's owner wrote.",
		inputSchema: object(
			{
				page_id: pageId,
				comment_id: string("The comment (see read_page)."),
				body: string("Its new text, as Markdown (as add_comment's)."),
			},
			["page_id", "comment_id", "body"],
		),
		annotations: changes,
		write: true,
		run: (args) =>
			Effect.as(
				Api.changeComment(str(args.page_id) ?? "", {
					op: "edit",
					comment: str(args.comment_id) ?? "",
					body: str(args.body) ?? "",
				}),
				"Edited the comment.",
			),
	},
	{
		name: "delete_comment",
		title: "Delete a comment",
		description:
			"Deletes a comment the token's owner wrote; a thread left with no comments goes too.",
		inputSchema: object({ page_id: pageId, comment_id: string("The comment (see read_page).") }, [
			"page_id",
			"comment_id",
		]),
		annotations: { ...changes, idempotentHint: true },
		write: true,
		run: (args) =>
			Effect.as(
				Api.changeComment(str(args.page_id) ?? "", {
					op: "delete",
					comment: str(args.comment_id) ?? "",
				}),
				"Deleted the comment.",
			),
	},
	{
		name: "react_to_comment",
		title: "React to a comment",
		description: `Adds the token owner's reaction to a comment, or takes it back if they already reacted with that emoji. One of ${REACTIONS.join(" ")}. Answers with the comment's reactions.`,
		inputSchema: object(
			{
				page_id: pageId,
				comment_id: string("The comment (see read_page)."),
				emoji: { type: "string", enum: [...REACTIONS] },
			},
			["page_id", "comment_id", "emoji"],
		),
		annotations: { ...changes, destructiveHint: false },
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				const comment = str(args.comment_id) ?? "";
				yield* Api.changeComment(id, { op: "react", comment, emoji: str(args.emoji) ?? "" });
				const found = (yield* Api.pageComments(id))
					.flatMap((t) => t.comments)
					.find((c) => c.id === comment);
				return { commentId: comment, reactions: found?.reactions ?? [] };
			}),
	},
	{
		name: "trash_page",
		title: "Move a page to Trash",
		description:
			"Moves a page (or a database with its rows, or a row) to Trash. It can be restored there for 30 days.",
		inputSchema: object({ page_id: pageId }, ["page_id"]),
		annotations: { ...changes, idempotentHint: true },
		write: true,
		run: (args) => Effect.as(Api.trashPage(str(args.page_id) ?? ""), "Moved to Trash."),
	},
];
