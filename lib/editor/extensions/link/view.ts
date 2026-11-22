import { el, placeFixed } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import type { LinkUIState } from "./state.ts";

export interface LinkUIView {
	popover: HTMLElement;
	card: HTMLElement;
	render(state: LinkUIState, prev?: LinkUIState): void;
	destroy(): void;
}

/** The URL editor popover and the hover card over links. */
export function createLinkUIView(options: {
	onCommit: (value: string) => void;
	onCancel: () => void;
	onEdit: () => void;
	onUnlink: () => void;
}): LinkUIView {
	// ---- edit popover ----
	const popover = el("div", "link-pop");
	popover.hidden = true;
	const input = el("input", "link-input");
	input.type = "text";
	input.placeholder = "Paste a link…";
	input.setAttribute("aria-label", "Link URL");
	popover.append(input);
	document.body.append(popover);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			options.onCommit(input.value);
		} else if (event.key === "Escape") {
			event.preventDefault();
			options.onCancel();
		}
	});

	// ---- hover card ----
	const card = el("div", "link-card");
	card.hidden = true;
	const href = el("a", "link-card-url");
	href.target = "_blank";
	href.rel = "noreferrer noopener";
	const editButton = el("button", "link-card-btn", "Edit");
	editButton.type = "button";
	const unlinkButton = el("button", "link-card-btn");
	unlinkButton.type = "button";
	unlinkButton.innerHTML = icon("x", 14);
	unlinkButton.title = "Remove link";
	unlinkButton.setAttribute("aria-label", "Remove link");
	card.append(href, editButton, unlinkButton);
	document.body.append(card);
	editButton.addEventListener("click", options.onEdit);
	unlinkButton.addEventListener("click", options.onUnlink);

	return {
		popover,
		card,
		render(state, prev) {
			if (state.editing !== prev?.editing) {
				popover.hidden = !state.editing;
				if (state.editing) {
					input.value = state.editing.url;
					placeFixed(popover, state.editing.rect);
					input.focus();
					input.select();
				}
			}
			if (state.card !== prev?.card) {
				card.hidden = !state.card;
				if (state.card) {
					href.textContent = state.card.href.replace(/^https?:\/\//, "").replace(/\/$/, "");
					href.href = state.card.href;
					placeFixed(card, state.card.getBoundingClientRect());
				}
			}
		},
		destroy() {
			popover.remove();
			card.remove();
		},
	};
}
