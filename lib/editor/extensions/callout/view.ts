import { el } from "../../shared/dom.ts";

export interface EmojiPickerView {
	element: HTMLElement;
	/** Shows the choices under `at` (or over it when there's no room); null hides. */
	render(at: DOMRect | null): void;
	destroy(): void;
}

/** A small grid of emoji to pick from. */
export function createEmojiPickerView(
	choices: string[],
	onPick: (emoji: string) => void,
): EmojiPickerView {
	const picker = el("div", "emoji-pick");
	picker.hidden = true;
	picker.setAttribute("role", "listbox");
	picker.append(
		...choices.map((emoji) => {
			const button = el("button", "emoji-item", emoji);
			button.type = "button";
			button.addEventListener("click", () => onPick(emoji));
			return button;
		}),
	);
	document.body.append(picker);

	return {
		element: picker,
		render(at) {
			picker.hidden = !at;
			if (!at) return;
			const top = at.bottom + 4;
			picker.style.top = `${top + picker.offsetHeight < innerHeight ? top : Math.max(8, at.top - picker.offsetHeight - 4)}px`;
			picker.style.left = `${Math.max(8, Math.min(at.left, innerWidth - picker.offsetWidth - 8))}px`;
		},
		destroy: () => picker.remove(),
	};
}
