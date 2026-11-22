/**
 * Reading a web page's title, description, preview image and icon from its
 * HTML (Open Graph and Twitter card tags, then plain `<title>` / `<link
 * rel=icon>`), for bookmark cards. Pure; the `/unfurl` route does the fetching.
 */

export interface Preview {
	url: string;
	title: string;
	description: string;
	image: string | null;
	icon: string | null;
	site: string;
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	"#39": "'",
};

function decode(text: string): string {
	return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+|#39);/gi, (all, name: string) => {
		const lower = name.toLowerCase();
		if (lower.startsWith("#x"))
			return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 32);
		if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)) || 32);
		return ENTITIES[lower] ?? all;
	});
}

const clean = (text: string | undefined, max: number) =>
	decode(text ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);

/** The attributes of one tag (`<meta property="og:title" content="…">`), lowercased names. */
function attributes(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
		out[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
	return out;
}

/** An http(s) URL resolved against the page, or null. */
function absolute(href: string | undefined, base: URL): string | null {
	if (!href) return null;
	try {
		const url = new URL(decode(href.trim()), base);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

/** What a bookmark card shows for the page at `base` with this `html` (its `<head>` is enough). */
export function parsePreview(html: string, base: URL): Preview {
	const bodyAt = html.search(/<body[\s>]/i);
	const head = bodyAt > 0 ? html.slice(0, bodyAt) : html;
	const meta = new Map<string, string>();
	for (const m of head.matchAll(/<meta\s[^>]*>/gi)) {
		const a = attributes(m[0]);
		const name = (a.property ?? a.name ?? "").toLowerCase();
		if (name && a.content !== undefined && !meta.has(name)) meta.set(name, a.content);
	}
	let icon: string | null = null;
	for (const m of head.matchAll(/<link\s[^>]*>/gi)) {
		const a = attributes(m[0]);
		const rel = (a.rel ?? "").toLowerCase().split(/\s+/);
		if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
			icon = absolute(a.href, base);
			if (icon && rel.includes("icon")) break; // prefer the plain favicon
		}
	}
	const title =
		clean(meta.get("og:title") ?? meta.get("twitter:title"), 300) ||
		clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 300) ||
		base.hostname;
	return {
		url: base.href,
		title,
		description: clean(
			meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description"),
			500,
		),
		image: absolute(
			meta.get("og:image") ?? meta.get("twitter:image") ?? meta.get("og:image:url"),
			base,
		),
		icon: icon ?? absolute("/favicon.ico", base),
		site: clean(meta.get("og:site_name"), 100) || base.hostname.replace(/^www\./, ""),
	};
}

/**
 * Whether the server may fetch `url` for a preview: http(s) on the default
 * ports, and not a local or private address.
 */
export function fetchable(url: URL): boolean {
	if (url.protocol !== "https:" && url.protocol !== "http:") return false;
	if (url.port && url.port !== "80" && url.port !== "443") return false;
	if (url.username || url.password) return false;
	const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		h === "localhost" ||
		h.endsWith(".localhost") ||
		h.endsWith(".local") ||
		h.endsWith(".internal")
	)
		return false;
	if (!h.includes(".") && !h.includes(":")) return false;
	if (h.includes(":")) return false; // IPv6 literals: no previews
	const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
	if (ip) {
		const [a, b] = [Number(ip[1]), Number(ip[2])];
		if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
		if (a === 169 && b === 254) return false;
		if (a === 172 && b >= 16 && b <= 31) return false;
		if (a === 192 && b === 168) return false;
		if (a === 100 && b >= 64 && b <= 127) return false;
	}
	return true;
}
