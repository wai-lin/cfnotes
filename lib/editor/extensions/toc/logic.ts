/** A heading in the table of contents. */
export interface TocEntry {
	key: string;
	/** 1, 2 or 3 (h1–h3). */
	level: number;
	text: string;
}

/**
 * How far each entry is indented: by its level, relative to the page's
 * biggest heading, so a page that starts at h2 isn't indented at all.
 */
export function indents(entries: TocEntry[]): number[] {
	const top = Math.min(...entries.map((e) => e.level));
	return entries.map((e) => e.level - top);
}
