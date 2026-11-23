// cfnotes' service worker: pages stay readable offline.
//
// - Pages (`/p/…`) come from the network, and a copy is kept: offline, the
//   last copy is shown. Nothing is served from the cache while the network
//   answers, so no one edits an old copy by mistake.
// - The app's scripts, styles and fonts work the same way; uploaded images and
//   hashed assets never change, so they come from the cache first.
// - The page asks it to keep copies of the sidebar's pages too (`cache-pages`).
// - Writes aren't touched: `modules/offline/client/queue.ts` queues text edits.
//
// Signing out deletes every copy (see `modules/offline/client/offline.ts`).

const VERSION = "v1";
const PAGES = `cfnotes-pages-${VERSION}`;
const STATIC = `cfnotes-static-${VERSION}`;
/** Where the last page opened is kept, for `/` offline. */
const LAST = "/__offline/last";

const PAGE = /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Files that never change under the same URL. */
const IMMUTABLE = /^\/(files\/img\/|assets\/.+[.-][\w-]{8,}\.(js|css|woff2?)$)/;
const STATIC_TYPES = new Set(["script", "style", "font", "image", "manifest"]);

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(STATIC)
			.then((cache) => cache.addAll(["/favicon.svg", "/manifest.webmanifest", "/icon-192.png"])),
	);
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys())
				if (key.startsWith("cfnotes-") && key !== PAGES && key !== STATIC) await caches.delete(key);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET" || request.headers.has("range")) return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.searchParams.has("__action")) return;
	if (request.mode === "navigate") return event.respondWith(navigate(request, url));
	if (IMMUTABLE.test(url.pathname)) return event.respondWith(cacheFirst(request));
	if (STATIC_TYPES.has(request.destination)) return event.respondWith(networkFirst(request));
});

/** Whether a response is the page itself (not a redirect to sign in, or an error). */
const isPage = (response) => response.ok && response.type === "basic" && !response.redirected;

async function navigate(request, url) {
	try {
		const response = await fetch(request);
		if (PAGE.test(url.pathname) && isPage(response)) {
			const cache = await caches.open(PAGES);
			await cache.put(url.pathname, response.clone());
			await cache.put(LAST, new Response(url.pathname));
		}
		return response;
	} catch {
		const cache = await caches.open(PAGES);
		if (PAGE.test(url.pathname)) {
			const copy = await cache.match(url.pathname);
			if (copy) return copy;
		}
		if (url.pathname === "/") {
			const last = await cache.match(LAST);
			const path = last && (await last.text());
			if (path && (await cache.match(path))) return Response.redirect(path, 302);
		}
		return offlinePage(cache);
	}
}

async function cacheFirst(request) {
	const cache = await caches.open(STATIC);
	const copy = await cache.match(request);
	if (copy) return copy;
	const response = await fetch(request);
	if (response.ok && response.type === "basic") await cache.put(request, response.clone());
	return response;
}

async function networkFirst(request) {
	const cache = await caches.open(STATIC);
	try {
		const response = await fetch(request);
		if (response.ok && response.type === "basic") await cache.put(request, response.clone());
		return response;
	} catch (error) {
		const copy = await cache.match(request);
		if (copy) return copy;
		throw error;
	}
}

/** The pages kept for offline, as links: what's there to read. */
async function offlinePage(cache) {
	const links = [];
	for (const request of await cache.keys()) {
		const path = new URL(request.url).pathname;
		if (!PAGE.test(path)) continue;
		const html = await (await cache.match(request)).text();
		// Escaped already, as the server wrote it.
		const title = /<title>([\s\S]*?) · cfnotes<\/title>/.exec(html)?.[1] ?? "Untitled";
		links.push({ path, title });
	}
	links.sort((a, b) => a.title.localeCompare(b.title));
	const list = links.length
		? `<ul>${links.map((l) => `<li><a href="${l.path}">${l.title}</a></li>`).join("")}</ul>`
		: "<p>No pages have been saved on this device yet. Open some while you're online.</p>";
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · cfnotes</title><link rel="icon" href="/favicon.svg"><style>
body{margin:0;font:16px/1.6 system-ui,sans-serif;color:#37352f;background:#fff}
main{max-width:640px;margin:0 auto;padding:64px 24px}
h1{font-size:28px;margin:0 0 8px}p{color:#787774;margin:0 0 24px}
ul{list-style:none;padding:0;margin:0;border-top:1px solid #e9e9e7}
li{border-bottom:1px solid #e9e9e7}a{display:block;padding:10px 4px;color:inherit;text-decoration:none}a:hover{background:#f7f7f5}
@media (prefers-color-scheme:dark){body{background:#191919;color:#e6e6e4}p{color:#9b9a97}ul,li{border-color:#2f2f2f}a:hover{background:#252525}}
</style></head><body><main><h1>You're offline</h1><p>These pages are saved on this device. What you type is kept and saved when you're back online.</p>${list}</main></body></html>`,
		{ status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
	);
}

// The page lists pages to keep (the sidebar's), and asks again now and then.
self.addEventListener("message", (event) => {
	if (event.data?.type === "cache-pages" && Array.isArray(event.data.paths))
		event.waitUntil(cachePages(event.data.paths));
});

async function cachePages(paths) {
	const cache = await caches.open(PAGES);
	for (const path of paths.slice(0, 500)) {
		if (typeof path !== "string" || !PAGE.test(path)) continue;
		try {
			const response = await fetch(path, { headers: { accept: "text/html" } });
			// Signed out: stop rather than fetch every page for nothing.
			if (response.redirected || response.status === 401) return;
			if (isPage(response)) await cache.put(path, response);
		} catch {
			return;
		}
	}
}
