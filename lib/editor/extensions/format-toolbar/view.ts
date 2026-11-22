import type { ToolbarItem } from "../../core/extension.ts";
import type { Palette } from "../../shared/colors.ts";
import { caretRect, el, keepFocus } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import type { FormatToolbarState } from "./state.ts";

export interface FormatToolbarView {
	bar: HTMLElement;
	render(state: FormatToolbarState, prev?: FormatToolbarState): void;
	/** Puts the bar over the selection again (after a scroll). */
	place(): void;
	destroy(): void;
}

/**
 * A floating bar over the selected text: the buttons the extensions bring,
 * then A▾ for text color and highlight.
 */
export function createFormatToolbarView(options: {
	items: ToolbarItem[];
	textColors: Palette;
	backColors: Palette;
	onItem: (item: ToolbarItem) => void;
	onToggleColors: () => void;
	onStyle: (styles: Record<string, string | null>) => void;
	/** The selection has no box on screen: hide. */
	onLost: () => void;
}): FormatToolbarView {
	const bar = el("div", "fmt-bar");
	bar.setAttribute("role", "toolbar");
	bar.hidden = true;
	// Keep the editor's selection while pressing toolbar buttons.
	keepFocus(bar);

	const buttons = new Map<string, HTMLButtonElement>();
	for (const item of options.items) {
		const button = el("button", `fmt-btn${item.className ? ` ${item.className}` : ""}`);
		button.type = "button";
		button.innerHTML = icon(item.icon, 16);
		button.title = item.title ?? item.label;
		button.setAttribute("aria-label", item.label);
		button.addEventListener("click", () => options.onItem(item));
		buttons.set(item.id, button);
		bar.append(button);
	}

	// ---- A▾ : text color and highlight ----
	const colorButton = el("button", "fmt-btn fmt-color", "A");
	colorButton.type = "button";
	colorButton.title = "Text color";
	colorButton.setAttribute("aria-label", "Text color");
	colorButton.addEventListener("click", options.onToggleColors);
	bar.append(colorButton);

	const panel = el("div", "color-menu");
	panel.hidden = true;
	const swatchRow = (title: string, colors: Palette, property: "color" | "background-color") => {
		const row = el("div", "color-row");
		for (const [name, value] of colors) {
			const swatch = el("button", "color-swatch", "A");
			swatch.type = "button";
			swatch.title = name;
			swatch.setAttribute("aria-label", `${title}: ${name}`);
			if (value) swatch.style.setProperty(property, value);
			swatch.addEventListener("click", () => options.onStyle({ [property]: value }));
			row.append(swatch);
		}
		panel.append(el("div", "color-head", title), row);
	};
	swatchRow("Text color", options.textColors, "color");
	swatchRow("Background", options.backColors, "background-color");
	bar.append(panel);
	document.body.append(bar);

	const place = () => {
		const rect = caretRect();
		if (!rect || (rect.width === 0 && rect.height === 0)) return options.onLost();
		const top = rect.top - bar.offsetHeight - 8;
		bar.style.top = `${top > 8 ? top : rect.bottom + 8}px`;
		bar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 8))}px`;
	};

	return {
		bar,
		render(state) {
			bar.hidden = !state.visible;
			panel.hidden = !state.colors;
			for (const [id, button] of buttons) button.classList.toggle("is-on", state.active.has(id));
			if (state.visible) place();
		},
		place,
		destroy: () => bar.remove(),
	};
}
