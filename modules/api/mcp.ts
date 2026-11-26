/**
 * The MCP server (`/api/mcp`): Streamable HTTP without sessions. Each POST is
 * one JSON-RPC message, answered with JSON. Tools read and write the
 * workspace through `api.ts` (the tools are in `tools/`); a read-only token
 * gets only the reading ones.
 */
import { Effect, Option, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { Input } from "spacefn";

import Env from "#configs/env.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Tokens from "#modules/auth/tokens.ts";
import { SAVE_LIMITS } from "#modules/pages/pages.ts";

import { countCall, limitText } from "./limits.ts";
import { DATABASE_TOOLS } from "./tools/databases.ts";
import { PAGE_TOOLS } from "./tools/pages.ts";
import { str, toResult, type Tool } from "./tools/tool.ts";
import { WORKSPACE_TOOLS } from "./tools/workspace.ts";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER = { name: "cfnotes", title: "cfnotes", version: "1.0.0" };

const INSTRUCTIONS = `cfnotes is a private notes workspace, like Notion: pages in folders, and databases whose rows are pages with properties.
- Find things with search or list_pages; read one with read_page (Markdown).
- For a database, get_database shows its properties and their choices; query_database lists rows, filtered with "where" ({"Status": "Published"}, or operators: {"Date": {"after": "2026-11-01"}, "Tags": {"empty": true}}), "where_any" for OR, and sorted with "sort" (["-Date"]).
- create_database makes a database with its properties; update_database renames, adds, converts, moves and deletes properties, edits select options, and sets up relations, rollups and scripts. Add rows with create_page, or many at once with create_rows; update_rows changes many.
- create_view, update_view and delete_view manage a database's views (table, board, list, gallery, calendar, timeline) with their own filters, sorts and grouping.
- Write content as Markdown (GitHub's). Link to another page with [Title](/p/<id>). Toggles are <details><summary>…</summary>…</details>; equations $…$ or $$…$$.
- Properties are set by name: a select by its option name (a new name adds an option), multi-select as a list of names, dates as YYYY-MM-DD, dates & times as YYYY-MM-DDTHH:MM (no time zone), times as HH:MM, people as emails, relations as row ids.
- move_page, create_folder, update_folder and delete_folder organize the sidebar; list_trash and restore_page bring back what was trashed.
- update_page with "markdown" replaces the whole content; "append_markdown" adds to the end. edit_page changes one heading's section, or finds and replaces text. Someone may have the page open: prefer appending or edit_page to replacing everything.`;

/** Told to a friend's agent: what their token reaches. */
const FRIEND_NOTE = `
- This token is a friend's: it reaches only the pages and folders shared with them, each as view, comment or edit (list_folders says which). New pages, databases and folders go in folders shared with them to edit, not the top level.`;

// ---------------------------------------------------------------- tools

const TOOLS: Tool[] = [...PAGE_TOOLS, ...WORKSPACE_TOOLS, ...DATABASE_TOOLS];

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
	// A friend's requests are counted; past the limit, a tool says so to the agent.
	const limited = yield* countCall.pipe(
		Effect.as(null),
		Effect.catchTag("TooManyRequests", (error) => Effect.succeed(error)),
	);
	if (limited) {
		const text = limitText(limited.retryAfterSeconds);
		if (message.method === "tools/call")
			return reply(message.id, { content: [{ type: "text", text }], isError: true });
		return HttpServerResponse.setHeader(
			replyError(message.id, -32000, text, 429),
			"retry-after",
			String(limited.retryAfterSeconds ?? 60),
		);
	}
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
				instructions: (yield* Sessions.isOwner(caller.email))
					? INSTRUCTIONS
					: INSTRUCTIONS + FRIEND_NOTE,
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
			if (result._tag === "Success") return reply(message.id, toResult(result.success));
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
