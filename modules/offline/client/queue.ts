/**
 * Text edits made offline. A save or title change whose request can't reach
 * the server is kept on this device (IndexedDB) instead of failing, and sent
 * when the connection is back: the latest one per page, last write wins.
 * Everything else that writes needs a connection, and says so.
 *
 * It wraps `fetch`, through which Datastar's `@post` and the editor's own
 * saves go. A queued Datastar save is answered with `_saving: false` and
 * `_offline: true`, so the page says "Saved offline".
 */
import { mergePatch } from "#lib/datastar/index.ts";
import { toast } from "#lib/ui/toast.ts";

import { isRead, parseKey, queueKey, signalsEvent } from "../queue.ts";

interface Entry {
	key: string;
	body: string;
	/** When it was queued. */
	at: number;
}

const DB = "cfnotes-offline";
const STORE = "queue";
/** The queued keys, readable at once (IndexedDB isn't): which pages to open from the queue. */
const INDEX = "cfnotes:offline-queue";

let opened: Promise<IDBDatabase> | undefined;

const open = () =>
	(opened ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	}));

/** Runs one request in a transaction and waits for it to be committed. */
async function store<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
	const db = await open();
	return new Promise<T>((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const request = run(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(request.result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

const readIndex = (): string[] => {
	try {
		return JSON.parse(localStorage.getItem(INDEX) ?? "[]") as string[];
	} catch {
		return [];
	}
};

const writeIndex = (keys: string[]) => {
	try {
		if (keys.length > 0) localStorage.setItem(INDEX, JSON.stringify(keys));
		else localStorage.removeItem(INDEX);
	} catch {}
};

async function put(entry: Entry): Promise<void> {
	await store("readwrite", (s) => s.put(entry));
	writeIndex([...new Set([...readIndex(), entry.key])]);
}

/** Drops a key, unless it was queued again after `before`. */
async function drop(key: string, before = Infinity): Promise<void> {
	const entry = await get(key);
	if (!entry || entry.at > before) return;
	await store("readwrite", (s) => s.delete(key));
	writeIndex(readIndex().filter((k) => k !== key));
}

const get = (key: string) => store<Entry | undefined>("readonly", (s) => s.get(key));
const all = () => store<Entry[]>("readonly", (s) => s.getAll());

/** Whether this page has a queued edit (`action` is `save` or `title`), without waiting. */
export const isQueued = (path: string, action: string) =>
	readIndex().includes(`${path}?__action=${action}`);

/** A page's queued edit: the body that was posted, parsed. */
export async function queued(
	path: string,
	action: string,
): Promise<Record<string, unknown> | null> {
	try {
		const entry = await get(`${path}?__action=${action}`);
		return entry ? (JSON.parse(entry.body) as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Whether anything is still waiting to be sent. */
export const pending = () => readIndex().length > 0;

// ---------------------------------------------------------------- fetch

const send = window.fetch.bind(window);
let warned = 0;

/** A write that can't be kept offline failed for want of a connection. */
function needsConnection(): void {
	if (Date.now() - warned < 5000) return;
	warned = Date.now();
	toast({
		title: "You're offline",
		description: "Typing in pages is kept and saved later, but that change needs a connection.",
		type: "error",
	});
}

window.fetch = async (input, init) => {
	// A copy, so the body is still there to keep if the request fails.
	const request = input instanceof Request && !init ? input.clone() : new Request(input, init);
	const url = new URL(request.url);
	const key = queueKey(url, request.method, location.origin);
	const started = Date.now();
	try {
		const response = await send(input, init);
		// A newer edit got through: what was queued for it is out of date.
		if (key && response.ok) {
			if (isQueued(parseKey(key).path, parseKey(key).action)) await drop(key, started);
			if (parseKey(key).path === location.pathname && parseKey(key).action === "save")
				mergePatch({ _offline: false });
		}
		return response;
	} catch (error) {
		// A cancelled request isn't a lost connection.
		if (!(error instanceof TypeError)) throw error;
		if (!key) {
			if (request.method !== "GET" && !isRead(url, await request.text().catch(() => "")))
				needsConnection();
			throw error;
		}
		await put({ key, body: await request.text(), at: Date.now() });
		const datastar = request.headers.get("datastar-request") === "true";
		return new Response(datastar ? signalsEvent({ _saving: false, _offline: true }) : null, {
			status: 200,
			headers: datastar ? { "content-type": "text/event-stream" } : {},
		});
	}
};

// ---------------------------------------------------------------- sending

let sending: Promise<void> | undefined;

/**
 * Sends what's queued. The open page's own edits are sent by the page (its
 * editor saves them again), so a newer edit typed meanwhile isn't
 * overwritten; with `here`, they're sent from the queue too (when nothing more
 * will be typed, as on signing out).
 */
export async function flushQueue(here = false): Promise<void> {
	if (sending) await sending;
	return (sending = sendAll(here).finally(() => (sending = undefined)));
}

async function sendAll(here: boolean): Promise<void> {
	if (!navigator.onLine || !pending()) return;
	let entries: Entry[];
	try {
		entries = await all();
	} catch {
		return;
	}
	for (const entry of entries) {
		const { path } = parseKey(entry.key);
		if (path === location.pathname && !here) {
			resendHere(entry.key);
			continue;
		}
		let response: Response;
		try {
			response = await send(entry.key, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: entry.body,
			});
		} catch {
			return;
		}
		// Signed out: keep it for after signing in (`modules/auth/client/session.ts` says so).
		if (response.status === 401) return;
		await drop(entry.key, entry.at);
		if (!response.ok)
			toast({
				title: "An offline edit couldn't be saved",
				description:
					response.status === 404
						? "Its page was deleted."
						: "The server refused it. Open the page to check it.",
				type: "error",
			});
	}
}

/** The open page saves its queued edit again, as it does after a failed save. */
function resendHere(key: string): void {
	const { action } = parseKey(key);
	if (action === "save")
		(document.querySelector("notes-editor") as { resave?: () => void } | null)?.resave?.();
	if (action === "title") {
		const title = document.querySelector<HTMLInputElement>(".page-title");
		title?.dispatchEvent(new Event("input", { bubbles: true }));
	}
}

/** Forgets everything queued (on signing out). */
export async function clearQueue(): Promise<void> {
	writeIndex([]);
	try {
		await store("readwrite", (s) => s.clear());
	} catch {}
}
