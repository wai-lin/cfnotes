import type { NodeKey } from "lexical";

import { createStore } from "../../core/store";
import type { DropTarget } from "./logic";

export interface BlockHandlesState {
	/** The block the handle sits beside. */
	block: { key: NodeKey; element: HTMLElement } | null;
	/**
	 * The blocks the handle acts on: the whole block selection when the
	 * handle's block is part of it, otherwise just that block. Read when the
	 * grip is pressed, before anything can change the selection.
	 */
	group: NodeKey[];
	/** The open block menu: whether it offers "Turn into". */
	menu: { convertible: boolean } | null;
	/** The blocks being dragged, and where they'd land. */
	dragging: NodeKey[];
	drop: DropTarget | null;
}

export function createBlockHandlesStore() {
	return createStore<BlockHandlesState>({
		block: null,
		group: [],
		menu: null,
		dragging: [],
		drop: null,
	});
}
