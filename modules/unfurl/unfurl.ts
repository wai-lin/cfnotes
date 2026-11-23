/** Fetching a web page for its bookmark card. */
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { BadRequest } from "spacefn";

import { parseLink } from "#lib/editor/extensions/embed/providers.ts";

import { fetchable, parsePreview } from "./preview.ts";

export const Query = Schema.Struct({ url: Schema.String });

/** Most of a page we read looking for its `<head>`. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;

/** Reads up to `MAX_BYTES` of the body as text. */
async function readHead(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const decoder = new TextDecoder();
	let text = "";
	let bytes = 0;
	while (bytes < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		text += decoder.decode(value, { stream: true });
		if (/<\/head>|<body[\s>]/i.test(text)) break;
	}
	await reader.cancel().catch(() => {});
	return text;
}

/** The page's markup, following a few redirects itself so each hop is checked. */
async function fetchHead(start: URL, stopped: AbortSignal): Promise<{ url: URL; html: string }> {
	let url = start;
	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const res = await fetch(url.href, {
				redirect: "manual",
				signal: AbortSignal.any([stopped, AbortSignal.timeout(TIMEOUT_MS)]),
				headers: {
					accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
					"user-agent": "Mozilla/5.0 (compatible; cfnotes-preview/1.0)",
				},
			});
			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				await res.body?.cancel();
				const next = new URL(location, url);
				if (!fetchable(next)) break;
				url = next;
				continue;
			}
			if (res.ok && /html/i.test(res.headers.get("content-type") ?? ""))
				return { url, html: await readHead(res) };
			await res.body?.cancel();
			break;
		}
	} catch {
		// Unreachable or too slow: a card with just the address.
	}
	return { url, html: "" };
}

/** `{url, title, description, image, icon, site}`; a page that can't be read still gets a card. */
export const unfurl = Effect.fn("Unfurl.unfurl")(function* (query: typeof Query.Type) {
	const start = parseLink(query.url);
	if (!start || !fetchable(start))
		return yield* new BadRequest({ message: "That link can't be previewed" });
	const { url, html } = yield* Effect.promise((signal) => fetchHead(start, signal));
	return HttpServerResponse.jsonUnsafe(parsePreview(html, url), {
		headers: { "cache-control": html ? "private, max-age=86400" : "no-store" },
	});
});
