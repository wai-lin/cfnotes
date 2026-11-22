/**
 * Responses for page actions that `fetch` calls. An action that returns plain
 * data (or html) renders its whole page again; these answer with just that.
 */
import { HttpServerResponse } from "effect/http";
import type { Html } from "spacefn";

const NO_STORE = { "cache-control": "no-store" };

export const json = (body: unknown) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE });

export const fragment = (markup: Html) =>
	HttpServerResponse.text(markup.value, {
		contentType: "text/html; charset=utf-8",
		headers: NO_STORE,
	});
