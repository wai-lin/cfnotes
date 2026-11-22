export const MAX_TITLE_LENGTH = 200;

/** A title as stored: one line, single-spaced, not too long. */
export const cleanTitle = (value: unknown): string =>
	typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_LENGTH) : "";

/** A title as shown. */
export const pageLabel = (title: string): string => title.trim() || "Untitled";
