/** Pure rules for synced blocks: finding them in a document, and which copy wins. */

/** A serialized Lexical node (as in `editorState.toJSON()`). */
export interface JsonNode {
	type: string;
	children?: JsonNode[];
	syncId?: string;
	[key: string]: unknown;
}

/**
 * Every synced block in a serialized document: its id and each copy's children
 * as a JSON string (what's compared and saved). Synced blocks don't nest, so
 * their insides aren't searched.
 */
export function syncedIn(root: JsonNode): Map<string, string[]> {
	const found = new Map<string, string[]>();
	const walk = (node: JsonNode) => {
		if (node.type === "synced" && typeof node.syncId === "string") {
			const list = found.get(node.syncId) ?? [];
			list.push(JSON.stringify(node.children ?? []));
			found.set(node.syncId, list);
			return;
		}
		for (const child of node.children ?? []) walk(child);
	};
	walk(root);
	return found;
}

/**
 * After an edit: the content a synced block now has, given each copy on the
 * page and what it last had (`base`). The first copy that differs from `base`
 * is the one edited; `null` when none did.
 */
export function editedCopy(copies: string[], base: string): string | null {
	return copies.find((copy) => copy !== base) ?? null;
}

/** A copy of a synced block on the page after an update; `fresh` when it wasn't there before. */
export interface Copy {
	json: string;
	fresh: boolean;
}

/**
 * After an update, given the block's content before it (`base`): its content
 * now, whether that's an edit to save, and whether a copy must be redrawn to
 * match. Only copies that were already there count as edits: a pasted copy
 * may be old, so it takes the current content instead of giving its own.
 */
export function reconcile(
	copies: Copy[],
	base: string,
): { content: string; save: boolean; redraw: boolean } {
	const edited = editedCopy(
		copies.filter((c) => !c.fresh).map((c) => c.json),
		base,
	);
	const content = edited ?? base;
	return { content, save: edited !== null, redraw: copies.some((c) => c.json !== content) };
}

/**
 * What to do with a block once the server's content (`server`, `undefined`
 * when it was never saved) is back. `before` is the page's copy when it was
 * asked for and `now` its copy at the answer: an edit in between is kept.
 */
export function onLoaded(
	server: string | undefined,
	before: string,
	now: string,
): { show: string | null; save: string | null } {
	if (now !== before) return { show: null, save: now };
	if (server === undefined) return { show: null, save: now };
	return { show: server === now ? null : server, save: null };
}
