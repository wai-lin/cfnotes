/**
 * Reading themes and fonts: which there are, and what a saved choice
 * resolves to. Kept per device (localStorage), so a phone can read in Dusk
 * while the desktop stays light. Pure, so it's tested without a browser.
 */

export const THEMES = {
	system: { label: "System" },
	light: { label: "Light", color: "#ffffff" },
	dark: { label: "Dark", color: "#191919" },
	paper: { label: "Paper", color: "#f4ecd8" },
	dusk: { label: "Dusk", color: "#2b2a28" },
} as const;

export const FONTS = {
	sans: { label: "Default" },
	serif: { label: "Serif" },
	typewriter: { label: "Typewriter" },
} as const;

export type Theme = keyof typeof THEMES;
export type Font = keyof typeof FONTS;

export interface Appearance {
	theme: Theme;
	font: Font;
}

/** Where the choice is kept. */
export const STORAGE_KEY = "cfnotes:appearance";

/** The themes that are dark (they build on the dark tokens). */
export const DARK: ReadonlySet<string> = new Set(["dark", "dusk"]);

const isKey = <T extends object>(table: T, key: unknown): key is keyof T =>
	typeof key === "string" && Object.hasOwn(table, key);

/** A saved choice, read leniently: anything unknown is the default. */
export function parseAppearance(raw: string | null): Appearance {
	let saved: { theme?: unknown; font?: unknown } = {};
	try {
		saved = (JSON.parse(raw ?? "{}") as typeof saved | null) ?? {};
	} catch {}
	return {
		theme: isKey(THEMES, saved.theme) ? saved.theme : "system",
		font: isKey(FONTS, saved.font) ? saved.font : "sans",
	};
}

/** What the root element gets: the theme shown, its scheme, and the browser's bar colour. */
export function resolveAppearance(
	{ theme, font }: Appearance,
	prefersDark: boolean,
): { theme: Exclude<Theme, "system">; scheme: "light" | "dark"; color: string; font: Font } {
	const shown = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
	return {
		theme: shown,
		scheme: DARK.has(shown) ? "dark" : "light",
		color: THEMES[shown].color,
		font,
	};
}

/** Myanmar script (and its extensions), which needs taller lines than Latin text. */
const MYANMAR = /[က-႟ꧠ-꧿ꩠ-ꩿ]/;

/** Whether a page's title or content has Myanmar text (`has-myanmar` on the page). */
export const hasMyanmar = (...texts: (string | null | undefined)[]) =>
	texts.some((text) => !!text && MYANMAR.test(text));
