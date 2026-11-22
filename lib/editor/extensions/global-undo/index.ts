/**
 * ⌘Z / ⇧⌘Z (and ⌃Z / ⌃Y) undo and redo the page even when the caret isn't in
 * it: after dragging or deleting a block from its handle, clicking a button, or
 * clicking off the text. Lexical only hears keys pressed inside the editor, so
 * this listens on the document and hands them to the editor's history.
 *
 * Keys pressed in something that edits on its own (an input, a dialog, and
 * whatever `ignore` matches) are left to it.
 */
import { REDO_COMMAND, UNDO_COMMAND } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { listen } from "../../shared/dom.ts";

/** Where ⌘Z belongs to someone else. */
const OWN_UNDO = "input, textarea, select, [contenteditable]:not([contenteditable=false]), dialog";

export function globalUndoExtension({ ignore }: { ignore?: string } = {}): EditorExtension {
	const own = [OWN_UNDO, ignore].filter(Boolean).join(", ");
	return {
		name: "global-undo",
		register: ({ editor }) =>
			listen(document, "keydown", (event: KeyboardEvent) => {
				if (event.defaultPrevented || event.altKey || !(event.metaKey || event.ctrlKey)) return;
				const key = event.key.toLowerCase();
				const redo =
					(key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
				if (key !== "z" && !redo) return;
				const root = editor.getRootElement();
				if (!root?.isConnected) return;
				const target = event.target instanceof Element ? event.target : null;
				// Inside the editor, Lexical has it already.
				if (target && (root.contains(target) || target.closest(own))) return;
				if (document.querySelector("dialog[open]")) return;
				event.preventDefault();
				editor.dispatchCommand(redo ? REDO_COMMAND : UNDO_COMMAND, undefined);
			}),
	};
}
