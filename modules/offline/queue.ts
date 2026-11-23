/**
 * Which requests the offline queue keeps, and how it names them. Pure, so
 * it's tested without a browser; `client/queue.ts` does the storing.
 */

const PAGE = /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Text edits: a page's content and its title. Everything else needs a connection. */
export const QUEUED_ACTIONS = new Set(["save", "title"]);

/**
 * The queue's key for a request: `/p/<id>?__action=save` or `…=title`, or
 * `null` for one that isn't queued. Only the latest request per key matters.
 */
export function queueKey(url: URL, method: string, origin: string): string | null {
	if (method.toUpperCase() !== "POST" || url.origin !== origin || !PAGE.test(url.pathname))
		return null;
	const action = url.searchParams.get("__action");
	return action && QUEUED_ACTIONS.has(action) ? `${url.pathname}?__action=${action}` : null;
}

/** Page actions that only read, though they're posted: `{op}` for each. */
const READS: Record<string, Set<string>> = {
	synced: new Set(["get"]),
	comments: new Set(["list"]),
	dbOp: new Set(["get", "databases"]),
};

/** Whether a posted page action only reads (offline, its failure needs no warning). */
export function isRead(url: URL, body: string): boolean {
	const ops = READS[url.searchParams.get("__action") ?? ""];
	if (!ops) return false;
	try {
		return ops.has(String((JSON.parse(body) as { op?: unknown }).op));
	} catch {
		return false;
	}
}

/** The page a key belongs to, and its action. */
export function parseKey(key: string): { path: string; action: string } {
	const [path = "", query = ""] = key.split("?");
	return { path, action: new URLSearchParams(query).get("__action") ?? "" };
}

/** A Datastar response that sets signals, standing in for a save that was queued. */
export function signalsEvent(signals: Record<string, unknown>): string {
	return `event: datastar-patch-signals\ndata: signals ${JSON.stringify(signals)}\n\n`;
}
