import type { NodeKey } from "lexical";

import { createStore } from "../../core/store";
import type { TableMenuEntry } from "./logic";

export interface TableControlsState {
	/** The table under the pointer (its "+" bars show). */
	hoverKey: NodeKey | null;
	/** The cell holding the caret (its menu button shows while focused). */
	caretKey: NodeKey | null;
	focused: boolean;
	/** The open cell menu, at a point on screen. */
	menu: { entries: TableMenuEntry[]; active: number; x: number; y: number } | null;
}

export function createTableControlsStore() {
	return createStore<TableControlsState>({
		hoverKey: null,
		caretKey: null,
		focused: false,
		menu: null,
	});
}
