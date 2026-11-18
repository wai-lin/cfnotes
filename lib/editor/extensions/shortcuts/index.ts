import { COMMAND_PRIORITY_NORMAL, KEY_DOWN_COMMAND } from "lexical";

import type { EditorExtension } from "../../core/extension";
import {
	$duplicateBlock,
	$duplicateBlocks,
	$moveBlock,
	$moveBlocks,
	$selectedBlockKey,
	$selectedBlocks,
	$turnBlocksInto,
} from "../../shared/blocks";

/** Notion's ⌘⌥digit block conversions to block item ids, by `KeyboardEvent.code` (⌥ changes `key` on macOS). */
const TURN_KEYS: Record<string, string> = {
	Digit0: "paragraph",
	Digit1: "h1",
	Digit2: "h2",
	Digit3: "h3",
	Digit4: "todo",
	Digit5: "bullet",
	Digit6: "number",
	Digit7: "toggle",
	Digit8: "code",
};

/**
 * Notion-style block shortcuts: ⌘D duplicates the current block, ⌘⇧↑/↓ moves it,
 * and ⌘⌥0–8 turns it into another type (0 text, 1–3 headings, 4 to-do,
 * 5 bulleted, 6 numbered, 7 toggle, 8 code). ⌃ works in place of ⌘. With
 * blocks selected, each acts on all of them.
 */
export function shortcutsExtension(): EditorExtension {
	return {
		name: "shortcuts",
		register: ({ editor, schema }) =>
			editor.registerCommand(
				KEY_DOWN_COMMAND,
				(event: KeyboardEvent) => {
					if (!(event.metaKey || event.ctrlKey)) return false;

					if (event.altKey && !event.shiftKey) {
						const id = TURN_KEYS[event.code];
						const item = id && schema.items.find((candidate) => candidate.id === id);
						if (!item) return false;
						event.preventDefault();
						const blocks = $selectedBlocks();
						if (blocks.length > 0) $turnBlocksInto(editor, blocks, item.apply);
						else item.apply(editor);
						return true;
					}
					if (event.altKey) return false;

					const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
					const dir = event.key === "ArrowUp" ? -1 : 1;
					const blocks = $selectedBlocks();
					if (blocks.length > 0) {
						if (!event.shiftKey && event.code === "KeyD") {
							event.preventDefault();
							$duplicateBlocks(editor, blocks);
							return true;
						}
						if (event.shiftKey && vertical) {
							event.preventDefault();
							$moveBlocks(blocks, dir);
							return true;
						}
					}
					const isDuplicate = !event.shiftKey && event.code === "KeyD";
					const isMove = event.shiftKey && vertical;
					if (!isDuplicate && !isMove) return false;
					const key = $selectedBlockKey();
					if (!key) return false;
					event.preventDefault();
					if (isDuplicate) $duplicateBlock(editor, key);
					else $moveBlock(key, dir);
					return true;
				},
				COMMAND_PRIORITY_NORMAL,
			),
	};
}
