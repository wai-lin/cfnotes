import { caretRect, el, keepFocus } from "../../../shared/dom.ts";
import { icon } from "../../../shared/icons.ts";
import type { PasteMenuState } from "./state.ts";

/** The "Paste as" menu, under the caret. */
export function createPasteMenuView(options: {
	onChoose: (index: number) => void;
	/** Where to open when the caret has no box (the pasted line). */
	fallbackRect: () => DOMRect | null;
}): {
	element: HTMLElement;
	render(state: PasteMenuState, prev?: PasteMenuState): void;
	destroy(): void;
} {
	const menu = el("div", "paste-menu");
	menu.setAttribute("role", "menu");
	menu.hidden = true;
	keepFocus(menu);
	document.body.append(menu);
	let buttons: HTMLButtonElement[] = [];

	return {
		element: menu,
		render(state, prev) {
			if (state.pasted !== prev?.pasted) {
				menu.hidden = true;
				if (!state.pasted) return;
				menu.replaceChildren(el("div", "paste-menu-title", "Paste as"));
				buttons = state.options.map((option, index) => {
					const button = el("button", "paste-menu-item");
					button.type = "button";
					button.innerHTML = `${icon(option.icon, 16)}<span></span>`;
					button.querySelector("span")!.textContent = option.label;
					button.addEventListener("click", () => options.onChoose(index));
					menu.append(button);
					return button;
				});
				const rect = caretRect() ?? options.fallbackRect();
				if (rect) {
					menu.hidden = false;
					menu.style.left = `${Math.min(rect.left, innerWidth - 240) + scrollX}px`;
					menu.style.top = `${rect.bottom + scrollY + 6}px`;
				}
			}
			buttons.forEach((b, i) => b.classList.toggle("is-active", i === state.active));
		},
		destroy: () => menu.remove(),
	};
}
