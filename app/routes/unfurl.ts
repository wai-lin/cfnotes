import { parseLink } from "@lib/editor/extensions/embed/providers";
import { fetchable, parsePreview } from "@modules/unfurl";
import { defineHandler } from "spacefn/handler";

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

/**
 * `GET /unfurl?url=…` → `{url, title, description, image, icon, site}` for a
 * bookmark card. Follows a few redirects itself so each hop is checked; pages
 * that can't be read still get a card with their address.
 */
export const GET = defineHandler(async (c) => {
	const start = parseLink(c.req.query("url") ?? "");
	if (!start || !fetchable(start)) return c.json({ error: "invalid_url" }, 400);

	let url = start;
	let html = "";
	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const res = await fetch(url.href, {
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
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
			if (res.ok && /html/i.test(res.headers.get("content-type") ?? "")) html = await readHead(res);
			else await res.body?.cancel();
			break;
		}
	} catch {
		// Unreachable or too slow: a card with just the address.
	}

	return c.json(parsePreview(html, url), 200, {
		"cache-control": html ? "public, max-age=86400" : "no-store",
	});
});
