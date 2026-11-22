import type { NodeKey } from "lexical";

import { createStore } from "../../../core/store.ts";
import type { MermaidView } from "../mermaid/logic.ts";

/** What one code block's bar shows. */
export interface CodeBlockInfo {
	key: NodeKey;
	/** The language's display name. */
	language: string;
	/** The stored language id (normalized), to tick it in the picker. */
	languageId: string;
	/** Code / Preview / Split, for Mermaid blocks; null otherwise. */
	view: MermaidView | null;
}

export interface CodeToolbarState {
	blocks: CodeBlockInfo[];
	/** The block whose language picker is open. */
	menuKey: NodeKey | null;
}

export function createCodeToolbarStore() {
	return createStore<CodeToolbarState>({ blocks: [], menuKey: null });
}
