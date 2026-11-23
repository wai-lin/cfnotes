/**
 * Offline use: the service worker (`public/sw.js`) keeps pages readable, the
 * queue (`queue.ts`) keeps what's typed. This says when the connection is
 * gone or back, asks the worker to keep the sidebar's pages, and wipes it all
 * on signing out.
 */
import { toast, type ToastHandle } from "#lib/ui/toast.ts";

import { clearQueue, flushQueue, isQueued, pending, queued } from "./queue.ts";

/** How often the sidebar's pages are fetched again for offline reading. */
const REFRESH_MS = 6 * 60 * 60 * 1000;
const REFRESHED = "cfnotes:offline-refreshed";

let notice: ToastHandle | undefined;

function showState(): void {
	const offline = !navigator.onLine;
	document.documentElement.classList.toggle("is-offline", offline);
	notice?.dismiss();
	notice = undefined;
	if (offline)
		notice = toast({
			title: "You're offline",
			description: "You can read saved pages and keep writing. It's saved when you're back.",
			duration: Infinity,
		});
}

addEventListener("offline", showState);
addEventListener("online", () => {
	showState();
	toast({ title: "Back online" });
	void flushQueue();
});
addEventListener("focus", () => void flushQueue());

/** The page's title as it was last typed offline, put back in the title box (which saves it). */
async function restoreTitle(): Promise<void> {
	if (!isQueued(location.pathname, "title")) return;
	const body = await queued(location.pathname, "title");
	const input = document.querySelector<HTMLInputElement>(".page-title");
	if (!input || typeof body?.title !== "string" || input.value === body.title) return;
	input.value = body.title;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Asks the worker to keep the sidebar's pages, at most every few hours. */
async function keepSidebarPages(registration: ServiceWorkerRegistration): Promise<void> {
	if (!navigator.onLine) return;
	try {
		if (Date.now() - Number(localStorage.getItem(REFRESHED) ?? 0) < REFRESH_MS) return;
		localStorage.setItem(REFRESHED, String(Date.now()));
	} catch {
		return;
	}
	const paths = [...document.querySelectorAll<HTMLAnchorElement>(".nav a[href^='/p/']")].map(
		(a) => new URL(a.href).pathname,
	);
	const worker = registration.active ?? (await navigator.serviceWorker.ready).active;
	worker?.postMessage({ type: "cache-pages", paths: [...new Set(paths)] });
}

async function start(): Promise<void> {
	showState();
	void restoreTitle();
	void flushQueue();
	if (!("serviceWorker" in navigator)) return;
	try {
		const registration = await navigator.serviceWorker.register("/sw.js");
		const idle = window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 2000));
		idle(() => void keepSidebarPages(registration));
	} catch (error) {
		console.warn("[offline] the service worker didn't register", error);
	}
}

if (document.readyState === "complete") void start();
else addEventListener("load", () => void start(), { once: true });

/**
 * Before signing out: sends what's queued, then forgets every page kept on
 * this device. `false` when edits couldn't be sent yet.
 */
export async function signOutOffline(): Promise<boolean> {
	await flushQueue(true);
	if (pending()) return false;
	await clearQueue();
	try {
		localStorage.removeItem(REFRESHED);
		for (const key of await caches.keys()) if (key.startsWith("cfnotes-")) await caches.delete(key);
	} catch {}
	return true;
}
