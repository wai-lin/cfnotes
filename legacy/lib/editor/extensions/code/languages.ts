import { bundledLanguagesInfo } from "shiki/langs";

/**
 * The languages code blocks can use. Kept apart from the highlighter so the
 * language picker can show names without loading Shiki itself.
 */

/** Language id stored on code blocks that have no syntax highlighting. */
export const PLAIN_TEXT = "plaintext";

/** Shiki's built-in "no grammar" ids. */
const PLAIN_ALIASES = new Set(["plaintext", "plain", "text", "txt", "ansi"]);

/** Shown first in the language picker, in this order. */
const POPULAR = [
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"html",
	"css",
	"json",
	"python",
	"shellscript",
	"sql",
	"go",
	"rust",
	"java",
	"c",
	"cpp",
	"csharp",
	"php",
	"ruby",
	"swift",
	"kotlin",
	"yaml",
	"markdown",
	"diff",
];

export interface LanguageOption {
	id: string;
	name: string;
	aliases: string[];
}

let options: LanguageOption[] | undefined;

/** Every language the picker offers: plain text, popular ones, then the rest A–Z. */
export function languageOptions(): LanguageOption[] {
	if (!options) {
		const all = bundledLanguagesInfo.map((info) => ({
			id: info.id,
			name: info.name,
			aliases: info.aliases ?? [],
		}));
		const rank = (id: string) => {
			const i = POPULAR.indexOf(id);
			return i < 0 ? POPULAR.length : i;
		};
		all.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
		options = [{ id: PLAIN_TEXT, name: "Plain text", aliases: ["text", "txt", "plain"] }, ...all];
	}
	return options;
}

/** Canonical Shiki id for a stored language (`ts` → `typescript`), or null for plain text. */
export function resolveLanguage(language: string | null | undefined): string | null {
	if (!language || PLAIN_ALIASES.has(language)) return null;
	const info = bundledLanguagesInfo.find(
		(item) => item.id === language || item.aliases?.includes(language),
	);
	return info?.id ?? null;
}

export function languageName(language: string | null | undefined): string {
	const id = resolveLanguage(language);
	return languageOptions().find((option) => option.id === id)?.name ?? "Plain text";
}

/** The languages matching a search: name, id or alias; prefix matches first. */
export function searchLanguages(query: string): LanguageOption[] {
	const q = query.trim().toLowerCase();
	const all = languageOptions();
	if (!q) return all;
	return (
		all
			.filter(
				(o) =>
					o.name.toLowerCase().includes(q) ||
					o.id.includes(q) ||
					o.aliases.some((alias) => alias.includes(q)),
			)
			// Prefix matches first, keeping the picker's order otherwise.
			.sort(
				(a, b) =>
					Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)),
			)
	);
}
