import { html, raw, type Html } from "spacefn";

import { DARK, FONTS, STORAGE_KEY, THEMES } from "./appearance.ts";

const colors = Object.fromEntries(
	Object.entries(THEMES).flatMap(([id, theme]) => ("color" in theme ? [[id, theme.color]] : [])),
);

/**
 * For every document's `<head>`: the theme-color tag, and a script that puts
 * the saved theme and font on the root before the first paint, so nothing
 * flashes. It mirrors `resolveAppearance` (client/appearance.ts keeps it
 * up to date after that).
 */
export function appearanceHead(): Html {
	const config = JSON.stringify({
		key: STORAGE_KEY,
		colors,
		dark: [...DARK],
		fonts: Object.keys(FONTS),
	});
	return html`<meta name="theme-color" content="${THEMES.light.color}" />
		<script>
			(() => {
				const c = ${raw(config)};
				let s = {};
				try {
					s = JSON.parse(localStorage.getItem(c.key) ?? "{}") ?? {};
				} catch {}
				const theme = Object.hasOwn(c.colors, s.theme)
					? s.theme
					: matchMedia("(prefers-color-scheme: dark)").matches
						? "dark"
						: "light";
				const root = document.documentElement;
				root.dataset.theme = theme;
				root.dataset.scheme = c.dark.includes(theme) ? "dark" : "light";
				root.dataset.font = c.fonts.includes(s.font) ? s.font : "sans";
				document.querySelector('meta[name="theme-color"]').content = c.colors[theme];
			})();
		</script>`;
}
