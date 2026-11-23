/**
 * The REST API's requests (`/api/v1/…`): each reads its input and calls
 * `api.ts`. A token reaches these through `modules/auth/guard.ts`; changes
 * need a token with write access.
 */
import { Effect, Option, Schema } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { BadRequest, Input, middleware, NotFound } from "spacefn";

import { Id } from "#lib/ids.ts";
import * as Tokens from "#modules/auth/tokens.ts";
import * as Files from "#modules/files/files.ts";
import { SAVE_LIMITS } from "#modules/pages/pages.ts";

import * as Api from "./api.ts";

/** Anything but reading needs a token that may write. */
export const writesNeedScope = middleware((next) =>
	Effect.gen(function* () {
		const { method } = yield* HttpServerRequest.HttpServerRequest;
		if (method !== "GET" && method !== "HEAD") yield* Tokens.requireWrite;
		return yield* next;
	}),
);

const id = Effect.map(Input.params(Schema.Struct({ id: Id })), (p) => p.id);
const created = (body: unknown) => HttpServerResponse.jsonUnsafe(body, { status: 201 });

/** `GET /api/v1/me`: who the token acts for, and whether it may write. */
export const me = Effect.gen(function* () {
	const caller = yield* Tokens.caller;
	if (Option.isNone(caller)) return yield* new NotFound({ message: "No token" });
	return caller.value;
});

/** `GET /api/v1/pages?kind=page|database|row&database=<id>` */
export const listPages = Effect.gen(function* () {
	const query = yield* Input.query(
		Schema.Struct({
			kind: Schema.optional(Schema.String),
			database: Schema.optional(Schema.String),
		}),
	);
	return { pages: yield* Api.listPages(query) };
});

/** `POST /api/v1/pages` with `{title, markdown | doc, folder | database, icon, properties}` */
export const createPage = Effect.gen(function* () {
	const input = yield* Input.body(Api.NewPage, SAVE_LIMITS);
	const pageId = yield* Api.createPage(input);
	return created(yield* Api.getPage(pageId, { format: "markdown" }));
});

/** `GET /api/v1/pages/:id?format=html|markdown|json&pageUrl=…&fileUrl=…` */
export const getPage = Effect.gen(function* () {
	return yield* Api.getPage(yield* id, yield* Input.query(Api.ReadOptions));
});

/** `PATCH /api/v1/pages/:id` with `{title, markdown | doc | append, icon, properties}` */
export const updatePage = Effect.gen(function* () {
	const pageId = yield* id;
	yield* Api.updatePage(pageId, yield* Input.body(Api.PageChanges, SAVE_LIMITS));
	return yield* Api.getPage(pageId, { format: "markdown" });
});

/** `DELETE /api/v1/pages/:id`: to Trash. */
export const trashPage = Effect.gen(function* () {
	yield* Api.trashPage(yield* id);
});

/** `GET /api/v1/pages/:id/comments` */
export const listComments = Effect.gen(function* () {
	return { threads: yield* Api.pageComments(yield* id) };
});

/** `POST /api/v1/pages/:id/comments` with `{body, thread?}` */
export const addComment = Effect.gen(function* () {
	const pageId = yield* id;
	const thread = yield* Api.addComment(pageId, yield* Input.body(Api.NewComment));
	const threads = yield* Api.pageComments(pageId);
	return created(threads.find((t) => t.id === thread));
});

/** `GET /api/v1/folders` */
export const listFolders = Effect.map(Api.listFolders, (folders) => ({ folders }));

/** `GET /api/v1/databases` */
export const listDatabases = Effect.map(Api.listDatabases, (databases) => ({ databases }));

/** `GET /api/v1/databases/:id` */
export const getDatabase = Effect.flatMap(id, Api.getDatabase);

/**
 * `GET /api/v1/databases/:id/rows?where.Status=Published&sort=-Date&limit=&offset=&view=&content=html`
 */
export const queryRows = Effect.gen(function* () {
	const databaseId = yield* id;
	const request = yield* HttpServerRequest.HttpServerRequest;
	const params = new URL(request.url, "http://api").searchParams;
	const where: Record<string, string> = {};
	for (const [key, value] of params) if (key.startsWith("where.")) where[key.slice(6)] = value;
	const number = (key: string) => {
		const value = params.get(key);
		return value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
	};
	const query = yield* Schema.decodeUnknownEffect(Api.RowsQuery)({
		where,
		sort: params
			.getAll("sort")
			.flatMap((s) => s.split(","))
			.filter(Boolean),
		view: params.get("view") ?? undefined,
		limit: number("limit"),
		offset: number("offset"),
		content: params.get("content") ?? undefined,
		pageUrl: params.get("pageUrl") ?? undefined,
		fileUrl: params.get("fileUrl") ?? undefined,
	}).pipe(Effect.mapError(() => new BadRequest({ message: "Bad query: see docs/api.md" })));
	return yield* Api.queryRows(databaseId, query);
});

/** `GET /api/v1/search?q=…` */
export const search = Effect.gen(function* () {
	const { q } = yield* Input.query(Schema.Struct({ q: Schema.optional(Schema.String) }));
	return { results: yield* Api.search(q ?? "") };
});

/** `GET /api/v1/files/<key>`: an uploaded file, as the app serves it. */
export const file = Effect.gen(function* () {
	const { key } = yield* Input.params(Files.Key);
	const { name } = yield* Input.query(Files.Download);
	const { headers } = yield* HttpServerRequest.HttpServerRequest;
	return yield* Files.serve(key, name, headers.range);
});
