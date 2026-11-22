import { createStore } from "../../core/store";

export interface LinkUIState {
	/** The URL editor, open under `rect` with `url` in it. */
	editing: { rect: DOMRect; url: string } | null;
	/** The link whose hover card (Open / Edit / Unlink) shows. */
	card: HTMLAnchorElement | null;
}

export function createLinkUIStore() {
	return createStore<LinkUIState>({ editing: null, card: null });
}
