/**
 * Small server-side helpers for answering Datastar requests.
 *
 * Datastar posts its signals as the JSON body itself (`{"title":"..."}`).
 * `readSignals` also accepts a body nested under `datastar`, so either shape works.
 */

/** A plain string, or spacefn's `html` / `raw` output (both carry `.value`). */
type Markup = string | { value: string };

function markupText(markup: Markup): string {
	return typeof markup === "string" ? markup : markup.value;
}

/** Reads the posted Datastar signals as an untrusted record. Validate every field. */
export async function readSignals(req: {
	json<T>(): Promise<T>;
}): Promise<Record<string, unknown>> {
	let body: unknown;
	try {
		body = await req.json<unknown>();
	} catch {
		return {};
	}
	if (!body || typeof body !== "object") return {};
	const nested = (body as { datastar?: unknown }).datastar;
	if (nested && typeof nested === "object") return nested as Record<string, unknown>;
	return body as Record<string, unknown>;
}

/** One `datastar-patch-elements` event. Elements are matched by their `id`. */
export function patchElements(markup: Markup): string {
	const lines = markupText(markup)
		.split("\n")
		.map((line) => `data: elements ${line}`)
		.join("\n");
	return `event: datastar-patch-elements\n${lines}\n\n`;
}

/** One `datastar-patch-signals` event. */
export function patchSignals(signals: Record<string, unknown>): string {
	return `event: datastar-patch-signals\ndata: signals ${JSON.stringify(signals)}\n\n`;
}

/** Sends a finished batch of Datastar events as one SSE response. */
export function sse(...events: string[]): Response {
	return new Response(events.join(""), {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}
