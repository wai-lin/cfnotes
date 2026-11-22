import { createEmptyHistoryState, registerHistory } from "@lexical/history";

import type { EditorExtension } from "../../core/extension.ts";

/** Undo and redo. Edits within `delay` ms of each other undo together. */
export function historyExtension({ delay = 300 }: { delay?: number } = {}): EditorExtension {
	return {
		name: "history",
		register: ({ editor }) => registerHistory(editor, createEmptyHistoryState(), delay),
	};
}
