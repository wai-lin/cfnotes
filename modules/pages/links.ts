import { PAGE_LINK_TYPE } from "#lib/editor/extensions/page-link/type.ts";

export { PAGE_LINK_TYPE };

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Most links we index per page; anything past this is still shown, just not counted as a backlink. */
export const MAX_LINKS = 500;

/**
 * The distinct page ids a serialized editor state links to, in document order.
 * `selfId` is left out (a page linking to itself isn't a backlink).
 */
export function pageLinksIn(state: unknown, selfId?: string): string[] {
	const found = new Set<string>();
	const stack: unknown[] = [
		state && typeof state === "object" ? (state as { root?: unknown }).root : null,
	];
	while (stack.length > 0 && found.size < MAX_LINKS) {
		const node = stack.pop();
		if (!node || typeof node !== "object") continue;
		const { type, pageId, children } = node as {
			type?: unknown;
			pageId?: unknown;
			children?: unknown;
		};
		if (type === PAGE_LINK_TYPE && typeof pageId === "string" && ID_PATTERN.test(pageId)) {
			if (pageId !== selfId) found.add(pageId);
		}
		// Push in reverse so the stack pops children in document order.
		if (Array.isArray(children))
			for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
	}
	return [...found];
}
