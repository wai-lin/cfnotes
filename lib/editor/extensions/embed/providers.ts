/**
 * Which links can be shown in a page as an embedded player or viewer, and the
 * iframe address for each. Pure, so the editor and tests share it.
 */

export interface Embed {
	/** Who it's from, for the caption and the toolbar ("YouTube"). */
	provider: string;
	/** The iframe's `src`. */
	src: string;
	/** Width ÷ height for players that scale (videos); otherwise a fixed `height`. */
	aspect?: number;
	/** Default height in px when there's no `aspect`. */
	height?: number;
}

/** A link the reader typed or pasted, as a URL (adding `https://` when missing), or null. */
export function parseLink(raw: string): URL | null {
	const text = raw.trim();
	if (!text || /\s/.test(text)) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "https:" && url.protocol !== "http:") return null;
		if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
		return url;
	} catch {
		return null;
	}
}

const host = (url: URL) => url.hostname.toLowerCase().replace(/^(www|m)\./, "");
const ID = /^[\w-]+$/;

/** YouTube `t=` / `start=` as whole seconds (`90`, `1m30s`, `1h2m3s`). */
function seconds(value: string | null): number {
	if (!value) return 0;
	if (/^\d+$/.test(value)) return Number(value);
	const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
	return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: URL): Embed | null {
	const h = host(url);
	let id: string | null = null;
	if (h === "youtu.be") id = url.pathname.split("/")[1] ?? null;
	else if (h === "youtube.com" || h === "music.youtube.com" || h === "youtube-nocookie.com") {
		const parts = url.pathname.split("/").filter(Boolean);
		if (parts[0] === "watch") id = url.searchParams.get("v");
		else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
	}
	if (!id || !ID.test(id)) return null;
	const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
	const src = `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`;
	return { provider: "YouTube", src, aspect: 16 / 9 };
}

function vimeo(url: URL): Embed | null {
	const h = host(url);
	if (h !== "vimeo.com" && h !== "player.vimeo.com") return null;
	const parts = url.pathname.split("/").filter(Boolean);
	const at = parts.findIndex((p) => /^\d+$/.test(p));
	if (at < 0) return null;
	// Unlisted videos carry a hash after the id (vimeo.com/123/abc).
	const hash =
		url.searchParams.get("h") ?? (parts[at + 1] && ID.test(parts[at + 1]!) ? parts[at + 1] : null);
	return {
		provider: "Vimeo",
		src: `https://player.vimeo.com/video/${parts[at]}${hash ? `?h=${hash}` : ""}`,
		aspect: 16 / 9,
	};
}

function loom(url: URL): Embed | null {
	if (host(url) !== "loom.com") return null;
	const m = url.pathname.match(/^\/(?:share|embed)\/([\w-]+)/);
	return m ? { provider: "Loom", src: `https://www.loom.com/embed/${m[1]}`, aspect: 16 / 9 } : null;
}

function figma(url: URL): Embed | null {
	if (host(url) !== "figma.com") return null;
	if (!/^\/(file|design|proto|board|slides|deck)\//.test(url.pathname)) return null;
	return {
		provider: "Figma",
		src: `https://www.figma.com/embed?embed_host=cfnotes&url=${encodeURIComponent(url.href)}`,
		height: 450,
	};
}

function spotify(url: URL): Embed | null {
	if (host(url) !== "open.spotify.com") return null;
	const m = url.pathname.match(
		/^\/(?:intl-[\w-]+\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/,
	);
	if (!m) return null;
	const tall = m[1] !== "track" && m[1] !== "episode";
	return {
		provider: "Spotify",
		src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
		height: tall ? 352 : 152,
	};
}

function codepen(url: URL): Embed | null {
	if (host(url) !== "codepen.io") return null;
	const m = url.pathname.match(/^\/([\w-]+)\/(?:pen|embed|full|details)\/([\w-]+)/);
	return m
		? {
				provider: "CodePen",
				src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
				height: 400,
			}
		: null;
}

function codesandbox(url: URL): Embed | null {
	if (host(url) !== "codesandbox.io") return null;
	const m = url.pathname.match(/^\/(?:s|embed|p\/sandbox|p\/devbox)\/(?:[\w-]+-)?([\w]+)$/);
	return m
		? { provider: "CodeSandbox", src: `https://codesandbox.io/embed/${m[1]}`, height: 500 }
		: null;
}

function google(url: URL): Embed | null {
	const h = host(url);
	if (h === "docs.google.com") {
		const m = url.pathname.match(
			/^\/(document|spreadsheets|presentation|forms)\/d\/(e\/)?([\w-]+)/,
		);
		if (!m) return null;
		const kind = m[1]!;
		const base = `https://docs.google.com/${kind}/d/${m[2] ?? ""}${m[3]}`;
		const names: Record<string, string> = {
			document: "Google Docs",
			spreadsheets: "Google Sheets",
			presentation: "Google Slides",
			forms: "Google Forms",
		};
		const page =
			kind === "presentation" ? "embed" : kind === "forms" ? "viewform?embedded=true" : "preview";
		return {
			provider: names[kind]!,
			src: `${base}/${page}`,
			...(kind === "presentation" ? { aspect: 16 / 9 + 0.02 } : { height: 600 }),
		};
	}
	if (h === "drive.google.com") {
		const m = url.pathname.match(/^\/file\/d\/([\w-]+)/);
		return m
			? {
					provider: "Google Drive",
					src: `https://drive.google.com/file/d/${m[1]}/preview`,
					height: 480,
				}
			: null;
	}
	if ((h === "google.com" || h === "maps.google.com") && url.pathname.startsWith("/maps")) {
		// The keyless embed: whatever the link was searching for, or its coordinates.
		const at = url.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
		const place = url.pathname.match(/\/place\/([^/]+)/)?.[1];
		const q =
			url.searchParams.get("q") ??
			(place ? decodeURIComponent(place.replace(/\+/g, " ")) : at ? `${at[1]},${at[2]}` : null);
		return q
			? {
					provider: "Google Maps",
					src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`,
					height: 400,
				}
			: null;
	}
	return null;
}

function miro(url: URL): Embed | null {
	if (host(url) !== "miro.com") return null;
	const m = url.pathname.match(/^\/app\/board\/([\w=-]+)/);
	return m
		? { provider: "Miro", src: `https://miro.com/app/live-embed/${m[1]}/`, height: 450 }
		: null;
}

const PROVIDERS = [youtube, vimeo, loom, figma, spotify, codepen, codesandbox, google, miro];

/**
 * How to embed `url`: a known service's player, or (for any other page) the
 * page itself in a frame, which works unless the site refuses to be framed.
 */
export function embedFor(url: URL): Embed & { known: boolean } {
	for (const provider of PROVIDERS) {
		const embed = provider(url);
		if (embed) return { ...embed, known: true };
	}
	return { provider: host(url), src: url.href, height: 400, known: false };
}

/** Whether `url` is from a service with a real player, worth offering "Embed" for on paste. */
export function isEmbeddable(url: URL): boolean {
	return PROVIDERS.some((provider) => provider(url) !== null);
}
