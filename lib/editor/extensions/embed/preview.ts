/** A bookmark's card: what a link's page says about itself. */
export interface LinkPreview {
	url: string;
	title: string;
	description: string;
	image: string | null;
	icon: string | null;
	site: string;
}

/** Fetches a page's preview; null when there's none. Supplied by the app. */
export type PreviewFetcher = (url: string) => Promise<LinkPreview | null>;

let fetcher: PreviewFetcher | null = null;
const previews = new Map<string, Promise<LinkPreview | null>>();

export function setPreviewFetcher(next: PreviewFetcher | null): void {
	fetcher = next;
}

/** A link's preview, fetched once per page load (failures count as none). */
export function fetchPreview(url: string): Promise<LinkPreview | null> {
	if (!fetcher) return Promise.resolve(null);
	let pending = previews.get(url);
	if (!pending) {
		pending = fetcher(url).catch(() => null);
		previews.set(url, pending);
	}
	return pending;
}
