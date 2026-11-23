/**
 * The MCP server (`/api/mcp`): Streamable HTTP without sessions. Each POST is
 * one JSON-RPC message, answered with JSON. Tools read and write the
 * workspace through `api.ts`; a read-only token gets only the reading ones.
 */
import { Effect, Option, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Input } from "spacefn";

import Env from "#configs/env.ts";
import * as Tokens from "#modules/auth/tokens.ts";
import { SAVE_LIMITS } from "#modules/pages/pages.ts";

import * as Api from "./api.ts";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "cfnotes", title: "cfnotes", version: "1.0.0" };

const INSTRUCTIONS = `cfnotes is a private notes workspace, like Notion: pages in folders, and databases whose rows are pages with properties.
- Find things with search or list_pages; read one with read_page (Markdown).
- For a database, get_database shows its properties and their choices; query_database lists rows, filtered with "where" ({"Status": "Published"}) and sorted with "sort" (["-Date"]).
- Write content as Markdown (GitHub's). Link to another page with [Title](/p/<id>). Toggles are <details><summary>…</summary>…</details>; equations $…$ or $$…$$.
- Properties are set by name: a select or status by its option name (a new name adds an option), multi-select as a list of names, dates as YYYY-MM-DD, people as emails, relations as row ids.
- update_page with "markdown" replaces the whole content; "append_markdown" adds to the end. Someone may have the page open: prefer appending.`;

// ---------------------------------------------------------------- tools

type Json = Record<string, unknown>;

const string = (description: string): Json => ({ type: "string", description });
const pageId = string("The page's id (a UUID).");
const markdown = string("Content as Markdown.");
const properties: Json = {
	type: "object",
	description:
		'Database row properties by name, e.g. {"Status": "Draft", "Tags": ["news"], "Date": "2026-11-23"}.',
	additionalProperties: true,
};

interface Tool {
	name: string;
	title: string;
	description: string;
	inputSchema: Json;
	annotations: Json;
	write?: boolean;
	run: (args: Record<string, unknown>) => Effect.Effect<string, unknown, any>;
}

const object = (props: Json, required: string[] = []): Json => ({
	type: "object",
	properties: props,
	required,
	additionalProperties: false,
});

const readOnly = { readOnlyHint: true, openWorldHint: false };
const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The page as an agent reads it: what it is, then its content. */
const pageText = (page: Effect.Success<ReturnType<typeof Api.getPage>>, threads: unknown[]) => {
	const meta: Json = {
		id: page.id,
		kind: page.kind,
		url: page.url,
		updatedAt: page.updatedAt,
		updatedBy: page.updatedBy,
		...(page.database ? { database: page.database } : {}),
		...(page.properties ? { properties: page.properties } : {}),
		...(page.folderId ? { folderId: page.folderId } : {}),
	};
	const parts = [
		`# ${page.icon ? `${page.icon} ` : ""}${page.title || "Untitled"}`,
		"```json\n" + json(meta) + "\n```",
		String(page.content || "_(empty)_"),
	];
	if (threads.length > 0) parts.push(`## Comments\n\n\`\`\`json\n${json(threads)}\n\`\`\``);
	return parts.join("\n\n");
};

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const MARKDOWN_LINKS = { format: "markdown" as const, pageUrl: "/p/{id}" };

const TOOLS: Tool[] = [
	{
		name: "search",
		title: "Search pages",
		description:
			"Finds pages, databases and rows by words in their title or text. An empty query lists the most recently edited.",
		inputSchema: object({ query: string("Words to find.") }, ["query"]),
		annotations: readOnly,
		run: (args) => Effect.map(Api.search(str(args.query) ?? ""), json),
	},
	{
		name: "list_pages",
		title: "List pages",
		description:
			"Lists every page not in Trash, with its id, kind (page, database or row), folder and when it changed. Filter by kind or by database.",
		inputSchema: object({
			kind: { type: "string", enum: ["page", "database", "row"] },
			database_id: string("Only the rows of this database."),
		}),
		annotations: readOnly,
		run: (args) =>
			Effect.map(
				Api.listPages({ kind: str(args.kind), database: str(args.database_id) }),
				(pages) =>
					json(
						pages.map(({ id, title, kind, icon, folder, databaseId, updatedAt }) => ({
							id,
							title,
							kind,
							icon,
							folder: folder?.path ?? null,
							databaseId,
							updatedAt,
						})),
					),
			),
	},
	{
		name: "list_folders",
		title: "List folders",
		description: "Lists the folders, with their ids and paths, for putting new pages in.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Api.listFolders, json),
	},
	{
		name: "read_page",
		title: "Read a page",
		description:
			"Reads a page as Markdown: its title, properties (for a database row), content and comments.",
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
		name: "list_databases",
		title: "List databases",
		description: "Lists the databases, with their ids.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Api.listDatabases, json),
	},
	{
		name: "get_database",
		title: "Describe a database",
		description:
			"A database's properties (name, type, and the options of selects and statuses), its views and its number of rows.",
		inputSchema: object({ database_id: string("The database's id.") }, ["database_id"]),
		annotations: readOnly,
		run: (args) => Effect.map(Api.getDatabase(str(args.database_id) ?? ""), json),
	},
	{
		name: "query_database",
		title: "Query a database",
		description: "Lists a database's rows with their properties, filtered, sorted and paged.",
		inputSchema: object(
			{
				database_id: string("The database's id."),
				where: {
					type: "object",
					description:
						'Property name → value. Keeps rows whose property is the value (contains it, for multi-select, people and relations). Checkboxes: "true" or "false".',
					additionalProperties: { type: "string" },
				},
				sort: {
					type: "array",
					items: { type: "string" },
					description: 'Property names; "-Name" sorts descending.',
				},
				view: string("Start from a view's own filters and sorts (its name or id)."),
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 1000,
					description: "At most this many rows (100 if unset).",
				},
				offset: { type: "integer", minimum: 0 },
				include_content: { type: "boolean", description: "Also each row's content, as Markdown." },
			},
			["database_id"],
		),
		annotations: readOnly,
		run: (args) =>
			Effect.gen(function* () {
				const where =
					args.where && typeof args.where === "object"
						? (args.where as Record<string, unknown>)
						: {};
				const query = yield* Schema.decodeUnknownEffect(Api.RowsQuery)({
					where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, String(v)])),
					sort: Array.isArray(args.sort) ? args.sort.map(String) : undefined,
					view: str(args.view),
					limit: typeof args.limit === "number" ? args.limit : undefined,
					offset: typeof args.offset === "number" ? args.offset : undefined,
					content: args.include_content === true ? "markdown" : undefined,
					pageUrl: "/p/{id}",
				});
				return json(yield* Api.queryRows(str(args.database_id) ?? "", query));
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
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = yield* Api.createPage({
					title: str(args.title),
					markdown: str(args.markdown),
					folder: str(args.folder_id),
					database: str(args.database_id),
					icon: str(args.icon),
					properties:
						args.properties && typeof args.properties === "object"
							? (args.properties as Record<string, unknown>)
							: undefined,
				});
				return pageText(yield* Api.getPage(id, MARKDOWN_LINKS), []);
			}),
	},
	{
		name: "update_page",
		title: "Change a page",
		description:
			"Changes a page's title, icon or properties, replaces its content (markdown) or adds to its end (append_markdown). Answers with the page as it is now.",
		inputSchema: object(
			{
				page_id: pageId,
				title: string("A new title."),
				markdown: string("New content, replacing all of it."),
				append_markdown: string("Content to add at the end."),
				properties,
				icon: string("An emoji; empty to remove it."),
			},
			["page_id"],
		),
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: false,
		},
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				yield* Api.updatePage(id, {
					title: str(args.title),
					markdown: str(args.markdown),
					append: str(args.append_markdown),
					icon: str(args.icon),
					properties:
						args.properties && typeof args.properties === "object"
							? (args.properties as Record<string, unknown>)
							: undefined,
				});
				return pageText(yield* Api.getPage(id, MARKDOWN_LINKS), []);
			}),
	},
	{
		name: "add_comment",
		title: "Comment on a page",
		description:
			"Adds a comment on the whole page, or a reply in one of its threads (see read_page).",
		inputSchema: object(
			{
				page_id: pageId,
				body: string("The comment, as plain text."),
				thread_id: string("A thread to reply in."),
			},
			["page_id", "body"],
		),
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
		write: true,
		run: (args) =>
			Effect.gen(function* () {
				const id = str(args.page_id) ?? "";
				const thread = yield* Api.addComment(id, {
					body: str(args.body) ?? "",
					thread: str(args.thread_id),
				});
				return json((yield* Api.pageComments(id)).find((t) => t.id === thread));
			}),
	},
	{
		name: "trash_page",
		title: "Move a page to Trash",
		description:
			"Moves a page (or a database with its rows, or a row) to Trash. It can be restored there for 30 days.",
		inputSchema: object({ page_id: pageId }, ["page_id"]),
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: false,
		},
		write: true,
		run: (args) => Effect.as(Api.trashPage(str(args.page_id) ?? ""), "Moved to Trash."),
	},
];

/** The tools this caller may use. */
export const toolsFor = (scope: Tokens.Scope) =>
	TOOLS.filter((tool) => scope === "write" || !tool.write);

// ---------------------------------------------------------------- JSON-RPC

const KNOWN = new Set([
	"BadRequest",
	"NotFound",
	"Forbidden",
	"Conflict",
	"PayloadTooLarge",
	"Unauthorized",
	"SchemaError",
]);

/** A tool's failure as the agent reads it: our errors say why; anything else is logged. */
const failureText = (error: unknown) =>
	Effect.gen(function* () {
		const tag = (error as { _tag?: unknown })?._tag;
		const message = (error as { message?: unknown })?.message;
		if (typeof tag === "string" && KNOWN.has(tag))
			return `${tag}: ${typeof message === "string" ? message : ""}`;
		yield* Effect.logError("An MCP tool failed", error);
		return "Something went wrong on the server.";
	});

const reply = (id: unknown, result: unknown) =>
	HttpServerResponse.jsonUnsafe({ jsonrpc: "2.0", id, result });
const replyError = (id: unknown, code: number, message: string, status = 200) =>
	HttpServerResponse.jsonUnsafe(
		{ jsonrpc: "2.0", id: id ?? null, error: { code, message } },
		{ status },
	);

const Message = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.optional(Schema.Union([Schema.String, Schema.Number, Schema.Null])),
	method: Schema.String,
	params: Schema.optional(Schema.Unknown),
});

/** `POST /api/mcp`: one JSON-RPC request or notification. */
export const post = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest;
	// Browsers say where a request is from: only the app itself may call (no DNS rebinding).
	const origin = request.headers["origin"];
	if (origin && origin !== (yield* Env).ORIGIN)
		return replyError(null, -32600, "Origin not allowed", 403);
	const caller = Option.getOrUndefined(yield* Tokens.caller);
	if (!caller) return replyError(null, -32600, "Send an API token", 401);

	const body = yield* Input.body(Schema.Unknown, SAVE_LIMITS);
	if (Array.isArray(body)) return replyError(null, -32600, "Send one message at a time");
	const decoded = Schema.decodeUnknownOption(Message)(body);
	if (Option.isNone(decoded)) {
		// A response or something else that isn't a request: nothing to answer.
		if (body && typeof body === "object" && !("method" in body))
			return HttpServerResponse.empty({ status: 202 });
		return replyError(null, -32600, "Not a JSON-RPC request");
	}
	const message = decoded.value;
	if (message.id === undefined) return HttpServerResponse.empty({ status: 202 });
	const params = (
		message.params && typeof message.params === "object" ? message.params : {}
	) as Record<string, unknown>;

	switch (message.method) {
		case "initialize": {
			const asked = str(params.protocolVersion);
			return reply(message.id, {
				protocolVersion: asked && VERSIONS.includes(asked) ? asked : VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: SERVER,
				instructions: INSTRUCTIONS,
			});
		}
		case "ping":
			return reply(message.id, {});
		case "tools/list":
			return reply(message.id, {
				tools: toolsFor(caller.scope).map(
					({ name, title, description, inputSchema, annotations }) => ({
						name,
						title,
						description,
						inputSchema,
						annotations,
					}),
				),
			});
		case "tools/call": {
			const name = str(params.name);
			const tool = TOOLS.find((t) => t.name === name);
			if (!tool) return replyError(message.id, -32602, `Unknown tool: ${name}`);
			if (tool.write && caller.scope !== "write")
				return reply(message.id, {
					content: [{ type: "text", text: "This token can only read." }],
					isError: true,
				});
			const args = (
				params.arguments && typeof params.arguments === "object" ? params.arguments : {}
			) as Record<string, unknown>;
			const result = yield* Effect.result(tool.run(args));
			if (result._tag === "Success")
				return reply(message.id, { content: [{ type: "text", text: result.success }] });
			return reply(message.id, {
				content: [{ type: "text", text: yield* failureText(result.failure) }],
				isError: true,
			});
		}
		default:
			return replyError(message.id, -32601, `Method not found: ${message.method}`);
	}
});

/** `GET` and `DELETE /api/mcp`: no event stream and no sessions here. */
export const notAllowed = Effect.succeed(
	HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } }),
);
