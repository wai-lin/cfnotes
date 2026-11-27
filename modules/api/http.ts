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
import { countCall } from "./limits.ts";

/** Each request counts towards a friend's limits, and anything but reading needs a token that may write. */
export const tokenRules = middleware((next) =>
	Effect.gen(function* () {
		yield* countCall;
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

const Paging = {
	limit: Schema.optional(Schema.NumberFromString),
	offset: Schema.optional(Schema.NumberFromString),
};

/** `GET /api/v1/pages?kind=page|database|row&database=<id>&limit=&offset=`; every page without `limit`. */
export const listPages = Effect.gen(function* () {
	const { limit, offset, ...query } = yield* Input.query(
		Schema.Struct({
			kind: Schema.optional(Schema.String),
			database: Schema.optional(Schema.String),
			...Paging,
		}),
	);
	const pages = yield* Api.listPages(query);
	if (limit === undefined && offset === undefined)
		return { total: pages.length, nextOffset: null, pages };
	const { items, ...page } = Api.paged(pages, { limit, offset });
	return { ...page, pages: items };
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

/** `GET /api/v1/comments?status=open|resolved|all&mentions=me&limit=&offset=` */
export const listAllComments = Effect.gen(function* () {
	const { mentions, ...query } = yield* Input.query(
		Schema.Struct({
			status: Schema.optional(Schema.Literals(["open", "resolved", "all"])),
			mentions: Schema.optional(Schema.Literal("me")),
			...Paging,
		}),
	);
	return yield* Api.listComments({ ...query, mentionsMe: mentions === "me" });
});

/** `GET /api/v1/folders` */
export const listFolders = Effect.map(Api.listFolders, (folders) => ({ folders }));

/** `GET /api/v1/databases` */
export const listDatabases = Effect.map(Api.listDatabases, (databases) => ({ databases }));

/** `GET /api/v1/databases/:id` */
export const getDatabase = Effect.flatMap(id, Api.getDatabase);

/** `Date:after` → `["Date", "after"]`; a property without `:op` is equality. */
const whereKey = (key: string): [string, string | null] => {
	const at = key.lastIndexOf(":");
	return at > 0 && /^[a-z_]+$/.test(key.slice(at + 1))
		? [key.slice(0, at), key.slice(at + 1)]
		: [key, null];
};

/** Adds `value` for `key` (`Prop` or `Prop:op`) to a `where` object. */
const addWhere = (where: Record<string, unknown>, key: string, value: string) => {
	const [name, op] = whereKey(key);
	if (op === null) where[name] = value;
	else {
		const ops = (where[name] && typeof where[name] === "object" ? where[name] : {}) as Record<
			string,
			unknown
		>;
		// `where.Tags:empty` needs no value.
		ops[op] = value === "" ? true : value === "false" ? false : value;
		where[name] = ops;
	}
};

/**
 * `GET /api/v1/databases/:id/rows?where.Status=Published&where.Date:after=2026-11-01&any.0.Tags=news&sort=-Date&limit=&offset=&view=&content=html`
 */
export const queryRows = Effect.gen(function* () {
	const databaseId = yield* id;
	const request = yield* HttpServerRequest.HttpServerRequest;
	const params = new URL(request.url, "http://api").searchParams;
	const where: Record<string, unknown> = {};
	const any = new Map<string, Record<string, unknown>>();
	for (const [key, value] of params) {
		if (key.startsWith("where.")) addWhere(where, key.slice(6), value);
		const group = /^any\.(\d+)\.(.+)$/.exec(key);
		if (group) {
			if (!any.has(group[1]!)) any.set(group[1]!, {});
			addWhere(any.get(group[1]!)!, group[2]!, value);
		}
	}
	const number = (key: string) => {
		const value = params.get(key);
		return value !== null && Number.isFinite(Number(value)) ? Number(value) : undefined;
	};
	const query = yield* Schema.decodeUnknownEffect(Api.RowsQuery)({
		where,
		whereAny: any.size > 0 ? [...any.values()] : undefined,
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
	}).pipe(Effect.mapError(() => new BadRequest({ message: "Bad query: see /docs/api" })));
	return yield* Api.queryRows(databaseId, query);
});

/** `GET /api/v1/search?q=…&limit=&offset=` */
export const search = Effect.gen(function* () {
	const { q, ...paging } = yield* Input.query(
		Schema.Struct({ q: Schema.optional(Schema.String), ...Paging }),
	);
	return yield* Api.search(q ?? "", paging);
});

/** `POST /api/v1/files?attachment=true` with a multipart `file`: see `Api.uploadFile`. */
export const uploadFile = Effect.gen(function* () {
	const { attachment } = yield* Input.query(
		Schema.Struct({ attachment: Schema.optional(Schema.String) }),
	);
	const { file } = yield* Input.body(Files.Body, Files.MEDIA_LIMITS);
	const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
	return created(
		yield* Api.uploadFile(bytes, { name: file.name, attachment: attachment === "true" }),
	);
});

/** `GET /api/v1/files/<key>`: an uploaded file, as the app serves it. */
export const file = Effect.gen(function* () {
	const { key } = yield* Input.params(Files.Key);
	const { name } = yield* Input.query(Files.Download);
	const { headers } = yield* HttpServerRequest.HttpServerRequest;
	return yield* Files.serve(key, name, headers.range);
});
