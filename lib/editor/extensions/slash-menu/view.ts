import type { BlockItem } from "../../core/extension.ts";
import { el } from "../../shared/dom.ts";
import { createListboxView, type ListboxView } from "../../shared/typeahead/index.ts";

/** The `/` menu: each item's name with a short hint. */
export function createSlashMenuView(handlers: {
	onChoose: (index: number) => void;
	onHover: (index: number) => void;
}): ListboxView<BlockItem> {
	return createListboxView<BlockItem>({
		className: "slash-menu",
		renderItem: (button, item) => {
			button.append(el("span", "slash-label", item.label), el("span", "slash-hint", item.hint));
		},
		...handlers,
	});
}
