import { COMMAND_PRIORITY_NORMAL, KEY_DOWN_COMMAND, type LexicalEditor } from "lexical";

import { $duplicateBlock, $moveBlock, $selectedBlockKey } from "./block-ops";
import { $duplicateBlocks, $moveBlocks, $selectedBlocks, $turnBlocksInto } from "./block-select";
import { INSERT_EQUATION_COMMAND } from "./equation-node";
import { TURN_INTO_ITEMS } from "./slash-menu";

/** Notion's ⌘⌥digit block conversions, by `KeyboardEvent.code` (⌥ changes `key` on macOS). */
const TURN_KEYS: Record<string, string> = {
	Digit0: "Text",
	Digit1: "Heading 1",
	Digit2: "Heading 2",
	Digit3: "Heading 3",
	Digit4: "To-do list",
	Digit5: "Bulleted list",
	Digit6: "Numbered list",
	Digit7: "Toggle list",
	Digit8: "Code",
};

/**
 * Notion-style block shortcuts: ⌘D duplicates the current block, ⌘⇧↑/↓ moves it,
 * and ⌘⌥0–8 turns it into another type (0 text, 1–3 headings, 4 to-do,
 * 5 bulleted, 6 numbered, 7 toggle, 8 code). ⌘⇧E makes an inline equation
 * (from the selected text, if any). ⌃ works in place of ⌘. With
 * blocks selected (see `block-select.ts`), each acts on all of them.
 */
export function registerShortcuts(editor: LexicalEditor): () => void {
	return editor.registerCommand(
		KEY_DOWN_COMMAND,
		(event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return false;

			if (event.altKey && !event.shiftKey) {
				const label = TURN_KEYS[event.code];
				const item = label && TURN_INTO_ITEMS.find((candidate) => candidate.label === label);
				if (!item) return false;
				event.preventDefault();
				const blocks = $selectedBlocks();
				if (blocks.length > 0) $turnBlocksInto(editor, blocks, item.apply);
				else item.apply(editor);
				return true;
			}
			if (event.altKey) return false;

			if (event.shiftKey && event.code === "KeyE") {
				event.preventDefault();
				return editor.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true });
			}

			const blocks = $selectedBlocks();
			if (!event.shiftKey && event.code === "KeyD" && blocks.length > 0) {
				event.preventDefault();
				$duplicateBlocks(editor, blocks);
				return true;
			}
			if (
				event.shiftKey &&
				(event.key === "ArrowUp" || event.key === "ArrowDown") &&
				blocks.length > 0
			) {
				event.preventDefault();
				$moveBlocks(blocks, event.key === "ArrowUp" ? -1 : 1);
				return true;
			}
			if (!event.shiftKey && event.code === "KeyD") {
				const key = $selectedBlockKey();
				if (!key) return false;
				event.preventDefault();
				$duplicateBlock(editor, key);
				return true;
			}
			if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
				const key = $selectedBlockKey();
				if (!key) return false;
				event.preventDefault();
				$moveBlock(key, event.key === "ArrowUp" ? -1 : 1);
				return true;
			}
			return false;
		},
		COMMAND_PRIORITY_NORMAL,
	);
}
