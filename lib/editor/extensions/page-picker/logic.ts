/** `[[` opens the picker; the text typed after it filters the pages. */
export const PICKER_TRIGGER = { pattern: /\[\[([^[\]\n]{0,60})$/, prefix: "[[" };

export const MAX_RESULTS = 8;

export type Choice = { kind: "page"; id: string; title: string } | { kind: "new"; title: string };

/** Pages whose title contains `query`, the ones starting with it first. */
export function rankPages<T extends { title: string }>(pages: T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return pages.slice(0, MAX_RESULTS);
	const starts: T[] = [];
	const contains: T[] = [];
	for (const page of pages) {
		const title = page.title.toLowerCase();
		if (title.startsWith(q)) starts.push(page);
		else if (title.includes(q)) contains.push(page);
	}
	return [...starts, ...contains].slice(0, MAX_RESULTS);
}

/**
 * What the picker offers for `query`: matching pages (other than `self`), then
 * "New page" when pages can be made.
 */
export function pickerChoices(
	pages: { id: string; title: string }[],
	query: string,
	self: string | null,
	canCreate: boolean,
): Choice[] {
	const found = rankPages(
		pages.filter((page) => page.id !== self),
		query,
	);
	const choices: Choice[] = found.map((page) => ({ kind: "page", ...page }));
	if (canCreate) choices.push({ kind: "new", title: query.replace(/\s+/g, " ").trim() });
	return choices;
}

/** A choice's label in the menu. */
export function choiceLabel(choice: Choice): string {
	if (choice.kind === "page") return choice.title;
	return choice.title ? `New page “${choice.title}”` : "New page";
}
