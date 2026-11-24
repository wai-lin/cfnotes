/**
 * The sidebar's "Theme and font" button: picks the theme and the reading font. The
 * choice shows at once, is kept on this device, and reaches the other open
 * tabs. With "System", it follows the device's light or dark setting.
 */
import { icon } from "#lib/icons.ts";
import { Popover } from "#modules/database/client/popover.ts";

import {
	FONTS,
	hasMyanmar,
	parseAppearance,
	resolveAppearance,
	STORAGE_KEY,
	THEMES,
	type Appearance,
	type Font,
	type Theme,
} from "../appearance.ts";

const prefersDark = matchMedia("(prefers-color-scheme: dark)");

function read(): Appearance {
	try {
		return parseAppearance(localStorage.getItem(STORAGE_KEY));
	} catch {
		return parseAppearance(null);
	}
}

/** Puts a choice on the root, as the head script does on load. */
function apply(appearance: Appearance): void {
	const shown = resolveAppearance(appearance, prefersDark.matches);
	const root = document.documentElement;
	root.dataset.theme = shown.theme;
	root.dataset.scheme = shown.scheme;
	root.dataset.font = shown.font;
	const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (meta) meta.content = shown.color;
}

/** The item chosen last (`theme:paper`), focused again when the panel is redrawn. */
let chosen = "";

function save(change: Partial<Appearance>): void {
	chosen = Object.entries(change).map(([k, v]) => `${k}:${v}`)[0] ?? "";
	const next = { ...read(), ...change };
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {}
	apply(next);
	popover.refresh();
}

prefersDark.addEventListener("change", () => apply(read()));
// Chosen in another tab.
addEventListener("storage", (event) => {
	if (event.key === STORAGE_KEY) {
		apply(read());
		popover.refresh();
	}
});

const popover = new Popover();

/** A menu item that stays open when chosen, so themes can be tried one after another. */
function option(
	key: string,
	label: string,
	checked: boolean,
	run: () => void,
	swatch?: string,
	font?: Font,
) {
	const item = document.createElement("button");
	item.dataset.key = key;
	item.type = "button";
	item.className = "db-menu-item appearance-item";
	item.setAttribute("role", "menuitemradio");
	item.setAttribute("aria-checked", String(checked));
	if (swatch) {
		const dot = document.createElement("span");
		dot.className = "appearance-swatch";
		dot.style.background = swatch;
		item.append(dot);
	}
	const text = document.createElement("span");
	text.textContent = label;
	if (font) text.dataset.font = font;
	item.append(text);
	if (checked) item.insertAdjacentHTML("beforeend", icon("check", 14));
	item.addEventListener("click", run);
	return item;
}

function heading(text: string): HTMLElement {
	return Object.assign(document.createElement("div"), {
		className: "db-pop-label",
		textContent: text,
	});
}

function build(panel: HTMLElement): void {
	const now = read();
	panel.classList.add("appearance-pop");
	panel.setAttribute("aria-label", "Theme and font");
	const list = document.createElement("div");
	list.className = "db-menu";
	list.setAttribute("role", "menu");
	list.append(heading("Theme"));
	for (const [id, theme] of Object.entries(THEMES) as [Theme, (typeof THEMES)[Theme]][])
		list.append(
			option(
				`theme:${id}`,
				theme.label,
				now.theme === id,
				() => save({ theme: id }),
				"color" in theme
					? theme.color
					: `linear-gradient(135deg, ${THEMES.light.color} 50%, ${THEMES.dark.color} 50%)`,
			),
		);
	list.append(Object.assign(document.createElement("div"), { className: "db-menu-sep" }));
	list.append(heading("Font"));
	for (const [id, font] of Object.entries(FONTS) as [Font, (typeof FONTS)[Font]][])
		list.append(
			option(`font:${id}`, font.label, now.font === id, () => save({ font: id }), undefined, id),
		);
	panel.append(list);
	// Not the first item, which `Popover` focuses: the one just chosen, or the theme.
	const focus =
		panel.querySelector<HTMLElement>(`[data-key="${chosen}"]`) ??
		panel.querySelector<HTMLElement>(`[aria-checked="true"]`);
	queueMicrotask(() => focus?.focus());
}

document.addEventListener("click", (event) => {
	const button = (event.target as Element).closest<HTMLElement>(".side-appearance");
	if (!button) return;
	if (popover.isOpen) popover.close();
	else {
		chosen = "";
		// The panel is outside the sidebar: keep a peeking sidebar out while it's open.
		const side = button.closest(".sidebar");
		side?.classList.add("is-held");
		button.setAttribute("aria-expanded", "true");
		popover.open(button, build, () => {
			side?.classList.remove("is-held");
			button.setAttribute("aria-expanded", "false");
		});
	}
});

// Myanmar text needs taller lines: `has-myanmar` on the page, set by the
// server on load and kept up to date here as the title and text change.
let docHas: boolean | undefined;
const markMyanmar = (doc?: string) => {
	const page = document.querySelector<HTMLElement>("article.page");
	if (!page) return;
	if (doc !== undefined) docHas = hasMyanmar(doc);
	docHas ??= hasMyanmar(document.querySelector("notes-editor")?.getAttribute("state"));
	const title = document.querySelector<HTMLInputElement>(".page-title")?.value;
	page.classList.toggle("has-myanmar", docHas || hasMyanmar(title));
};
document.addEventListener("notes-change", (event) => {
	const { detail } = event as CustomEvent<unknown>;
	if (typeof detail === "string") markMyanmar(detail);
});
document.addEventListener("input", (event) => {
	if ((event.target as Element).matches?.(".page-title")) markMyanmar();
});
