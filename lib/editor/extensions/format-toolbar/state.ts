import { createStore } from "../../core/store.ts";

export interface FormatToolbarState {
	/** Shown over a text selection. */
	visible: boolean;
	/** The ids of the lit buttons. */
	active: ReadonlySet<string>;
	/** The text color / highlight panel is open. */
	colors: boolean;
}

export function createFormatToolbarStore() {
	return createStore<FormatToolbarState>({ visible: false, active: new Set(), colors: false });
}

/** Whether two sets hold the same ids. */
export const sameIds = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
	a.size === b.size && [...a].every((id) => b.has(id));
