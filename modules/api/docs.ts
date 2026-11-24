/**
 * The API and MCP docs, public at `/docs/api` (HTML) and `/docs/api.md`
 * (Markdown, for agents). `docs/api.md` is the source: what's served is that
 * file with the app's own address in the examples and without its notes on
 * the code.
 */
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { Input } from "spacefn";

import Env from "#configs/env.ts";

import source from "../../docs/api.md?raw";
import { fromMarkdown } from "./markdown.ts";
import { toHtml } from "./render.ts";
import { docsPage } from "./views.ts";

export const PATHS = ["/docs/api", "/docs/api.md"] as const;

const EXAMPLE_ORIGIN = "https://notes.example.com";

/** `docs/api.md` as readers get it, for the app at `origin`. */
export function publicMarkdown(origin: string): string {
	return source
		.replace(/\n## Code\n[\s\S]*?(?=\n## |$)/, "\n")
		.replaceAll(EXAMPLE_ORIGIN, origin)
		.trimEnd()
		.concat("\n");
}

const Params = Schema.Struct({ name: Schema.String });

// Public and the same for everyone, so caches may keep it a while.
const headers = { "cache-control": "public, max-age=300" };

export const get = Effect.gen(function* () {
	const { name } = yield* Input.params(Params);
	const markdown = publicMarkdown((yield* Env).ORIGIN);
	if (name === "api.md")
		return HttpServerResponse.text(markdown, {
			contentType: "text/markdown; charset=utf-8",
			headers,
		});
	if (name === "api") {
		const body = toHtml(fromMarkdown(markdown), {
			titles: {},
			synced: {},
			pageHref: (id) => `/p/${id}`,
			fileHref: (path) => path,
		});
		return HttpServerResponse.text(docsPage({ title: "API and MCP server", body }).value, {
			contentType: "text/html; charset=utf-8",
			headers,
		});
	}
	return HttpServerResponse.text("Not found", { status: 404 });
});
