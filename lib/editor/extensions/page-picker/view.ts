import { el } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import { createListboxView, type ListboxView } from "../../shared/typeahead/index.ts";
import { choiceLabel, type Choice } from "./logic.ts";

/** The `[[` picker: pages to link to, and "New page". */
export function createPagePickerView(handlers: {
	onChoose: (index: number) => void;
	onHover: (index: number) => void;
}): ListboxView<Choice> {
	return createListboxView<Choice>({
		className: "slash-menu page-picker",
		label: "Link to page",
		heading: "Link to page",
		renderItem: (button, choice) => {
			button.classList.add("page-pick");
			button.innerHTML = icon(choice.kind === "new" ? "filePlus" : "fileText");
			button.append(el("span", "slash-label", choiceLabel(choice)));
		},
		...handlers,
	});
}
