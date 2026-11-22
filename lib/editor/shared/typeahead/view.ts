import { caretRect, el, highlightItems, keepFocus, onPointerHover, placeFixed } from "../dom.ts";
import type { TypeaheadState } from "./state.ts";

export interface ListboxOptions<T> {
	className: string;
	label?: string;
	/** A heading above the items. */
	heading?: string;
	/** Fills an item's button (it already has the `slash-item` class). */
	renderItem: (button: HTMLButtonElement, item: T) => void;
	onChoose: (index: number) => void;
	onHover: (index: number) => void;
}

export interface ListboxView<T> {
	element: HTMLElement;
	render(state: TypeaheadState<T>, prev?: TypeaheadState<T>): void;
	/** Puts the menu under the caret (or over it when there's no room). */
	position(): void;
	destroy(): void;
}

/**
 * A menu of choices that follows the caret (the `/` menu, the `[[` picker).
 * The editor keeps focus: the keyboard drives the menu through the editor.
 */
export function createListboxView<T>(options: ListboxOptions<T>): ListboxView<T> {
	const menu = el("div", options.className);
	menu.setAttribute("role", "listbox");
	if (options.label) menu.setAttribute("aria-label", options.label);
	menu.hidden = true;
	keepFocus(menu);
	onPointerHover(menu, ".slash-item", options.onHover);
	menu.addEventListener("click", (event) => {
		const button = (event.target as Element).closest<HTMLElement>(".slash-item");
		const index = Number(button?.dataset.index ?? -1);
		if (index >= 0) options.onChoose(index);
	});
	document.body.append(menu);

	/** Rebuilt only when the items change, so a button under the pointer stays attached. */
	let rendered: T[] = [];
	const fill = (items: T[]) => {
		if (rendered.length === items.length && rendered.every((item, i) => item === items[i])) return;
		rendered = items;
		const buttons = items.map((item, index) => {
			const button = el("button", "slash-item");
			button.type = "button";
			button.setAttribute("role", "option");
			button.dataset.index = String(index);
			options.renderItem(button, item);
			return button;
		});
		const head = options.heading ? [el("div", "page-picker-head", options.heading)] : [];
		menu.replaceChildren(...head, ...buttons);
	};

	const position = () => {
		const rect = caretRect();
		if (rect) placeFixed(menu, rect);
	};

	return {
		element: menu,
		render(state, prev) {
			menu.hidden = state.match === null;
			if (!state.match) return;
			fill(state.items);
			highlightItems(menu, ".slash-item", state.active);
			// A new query (or a reopened menu) can change its size and the caret's place.
			if (!prev?.match || prev.match !== state.match) position();
		},
		position,
		destroy: () => menu.remove(),
	};
}
