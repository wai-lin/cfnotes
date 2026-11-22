/**
 * The pages the editor can link to. Sidebar pages are read from the sidebar
 * tree, which is already kept current (renames patch `#nav-<id>`, tree actions
 * swap `#page-nav`). Pages outside the sidebar (database rows, inline
 * databases) come from `#page-index`, rendered with the page, and are updated
 * by the tables on this page through `setIndexTitle`.
 */

import type { PageDirectory, PageEntry } from "@lib/editor";

const nav = () => document.querySelector<HTMLElement>("#page-nav");
const label = (title: string) => title.trim() || "Untitled";

let index: Map<string, string> | null = null;
function indexMap(): Map<string, string> {
	if (index) return index;
	index = new Map();
	try {
		const raw = JSON.parse(
			document.querySelector("#page-index")?.textContent ?? "[]",
		) as PageEntry[];
		for (const page of raw) index.set(page.id, page.title);
	} catch {}
	return index;
}

const listeners = new Set<() => void>();
let queued = false;
function emit() {
	if (queued) return;
	queued = true;
	queueMicrotask(() => {
		queued = false;
		for (const listener of listeners) listener();
	});
}

/** Every linkable page: the sidebar's in order, then the rest. */
export function allPages(): PageEntry[] {
	const root = nav();
	const sidebar = root
		? [...root.querySelectorAll<HTMLElement>(".tree-page[data-page]")].map((row) => ({
				id: row.dataset.page!,
				title: row.querySelector(".nav-label")?.textContent?.trim() || "Untitled",
			}))
		: [];
	const rest = [...indexMap()].map(([id, title]) => ({ id, title: label(title) }));
	return [...sidebar, ...rest];
}

/** A page's display title, or `null` when it no longer exists. */
export function titleOf(id: string): string | null {
	const link = document.getElementById(`nav-${id}`);
	if (link) return link.querySelector(".nav-label")?.textContent?.trim() || "Untitled";
	const title = indexMap().get(id);
	return title === undefined ? null : label(title);
}

/** Records a title change (or, with `null`, a deletion) of a page outside the sidebar. */
export function setIndexTitle(id: string, title: string | null): void {
	const map = indexMap();
	if (title === null ? !map.delete(id) : map.get(id) === title) return;
	if (title !== null) map.set(id, title);
	emit();
}

/** The page being edited (from the URL), if any. */
export function currentPageId(): string | null {
	return /^\/p\/([0-9a-f-]{36})\/?$/.exec(location.pathname)?.[1] ?? null;
}

let observing = false;
/** Calls `listener` whenever a page is added, renamed, moved or removed. */
export function onPagesChange(listener: () => void): () => void {
	const root = nav();
	if (root && !observing) {
		observing = true;
		new MutationObserver(emit).observe(root, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** The directory, as the editor's page links and `[[` picker use it. */
export const pageDirectory: PageDirectory = {
	pages: allPages,
	titleOf,
	currentPageId,
	subscribe: onPagesChange,
};

const PAGE_URL =
	/^(?:https?:\/\/([^/\s]+))?\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/;

/** The address of a page. */
export const pageHref = (id: string) => `/p/${id}`;

/** The page id in a link to a page of this app, if `text` is one. */
export function pageIdFromUrl(text: string): string | null {
	const found = PAGE_URL.exec(text.trim());
	if (!found) return null;
	if (found[1] && found[1] !== location.host) return null;
	return found[2] ?? null;
}
