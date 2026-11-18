/**
 * Where page links get their titles and addresses. Supplied by the app
 * (`pageLinkExtension({ directory, href })`); nodes read it as they draw,
 * so it's shared by the editors on a page.
 */

export interface PageEntry {
	id: string;
	title: string;
}

/** The pages that can be linked to. */
export interface PageDirectory {
	/** Every linkable page, in the order a picker should list them. */
	pages(): PageEntry[];
	/** A page's display title, or `null` when it no longer exists. */
	titleOf(id: string): string | null;
	/** The page being edited, if any (it isn't offered as a link). */
	currentPageId(): string | null;
	/** Calls `listener` whenever a page is added, renamed, moved or removed. */
	subscribe(listener: () => void): () => void;
}

export interface PageLinkConfig {
	directory: PageDirectory;
	/** The address of a page. */
	href: (id: string) => string;
}

let config: PageLinkConfig | null = null;

export function configurePageLinks(next: PageLinkConfig): void {
	config = next;
}

export const titleOf = (id: string): string | null => config?.directory.titleOf(id) ?? null;
export const hrefOf = (id: string): string => config?.href(id) ?? `#${id}`;
