/** What the `/` menu shows for a query: pure, so it's easy to test. */
export interface MenuItem {
	label: string;
	keywords: string;
	hiddenIn?: string[];
}

/**
 * The items matching `query` that may go where the caret is (`containers`).
 * Names starting with the query come first, then names containing it, then
 * keyword matches (so `/link` puts "Link to page" above "Web bookmark");
 * with no query, all of them in order.
 */
export function filterItems<T extends MenuItem>(
	items: readonly T[],
	query: string,
	containers: readonly string[],
): T[] {
	const q = query.trim().toLowerCase();
	const rank = (item: T) => {
		const label = item.label.toLowerCase();
		return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
	};
	return items
		.filter(
			(item) =>
				!item.hiddenIn?.some((name) => containers.includes(name)) &&
				(!q || item.label.toLowerCase().includes(q) || item.keywords.includes(q)),
		)
		.sort((a, b) => (q ? rank(a) - rank(b) : 0));
}

/** `/` at the start of a line or after a space, then up to 24 letters, digits or spaces. */
export const SLASH_TRIGGER = { pattern: /(?:^|\s)\/([\w ]{0,24})$/, prefix: "/" };
