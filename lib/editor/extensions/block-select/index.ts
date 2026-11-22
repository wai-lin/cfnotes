import { mergeRegister } from "@lexical/utils";
import {
	$getSelection,
	$isNodeSelection,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_BACKSPACE_COMMAND,
	KEY_DELETE_COMMAND,
	KEY_DOWN_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	type NodeKey,
} from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { createStore } from "../../core/store.ts";
import { $selectedBlocks } from "../../shared/blocks.ts";
import { listen } from "../../shared/dom.ts";
import {
	$deleteSelectedBlocks,
	$editFirstSelected,
	$escape,
	$selectElements,
	$stepSelection,
} from "./logic.ts";
import { blocksIn, createMarqueeView, type Box } from "./view.ts";

/** Never starts a marquee: the editor's text and its controls. */
const OWN_CONTROLS =
	".ne-content, button, input, a, textarea, select, dialog, [contenteditable='false'], .blk-handle, .fmt-bar, .slash-menu";

export interface BlockSelectOptions {
	/**
	 * Where a drag can start a selection box (a selector for the page around
	 * the editor). Without it there's no box, only the keyboard.
	 */
	marqueeArea?: string;
	/** Parts of that area that don't start one (headers, toolbars…). */
	marqueeIgnore?: string;
}

/**
 * Block-level selection, like Notion's:
 * - Escape selects the block being edited; Escape again clears it.
 * - Dragging from the page margin draws a box that selects the blocks it crosses.
 * - With blocks selected: ↑/↓ move the selection, ⇧↑/⇧↓ grow or shrink it,
 *   Backspace/Delete removes them, Enter edits the first one. Copy, cut, ⌘D,
 *   ⌘⇧↑/↓ and the handle menu act on all of them.
 */
export function blockSelectExtension(options: BlockSelectOptions = {}): EditorExtension {
	const ignore = [OWN_CONTROLS, options.marqueeIgnore].filter(Boolean).join(", ");
	return {
		name: "block-select",
		register({ editor }) {
			const store = createStore<{
				/** Where a shift-extension started, so ⇧↑ after ⇧↓ shrinks instead of growing. */
				anchorKey: NodeKey | null;
				marquee: Box | null;
			}>({ anchorKey: null, marquee: null });
			const marquee = createMarqueeView();
			const offRender = store.subscribe((state, prev) => {
				if (state.marquee !== prev.marquee) marquee.render(state.marquee);
			});

			// ---- highlight ----
			let marked: HTMLElement[] = [];
			const paint = () => {
				const keys = editor.getEditorState().read(() => $selectedBlocks().map((b) => b.getKey()));
				for (const element of marked) element.classList.remove("blk-selected");
				marked = keys.flatMap((key) => editor.getElementByKey(key) ?? []);
				for (const element of marked) element.classList.add("blk-selected");
				if (keys.length === 0) store.set({ anchorKey: null });
			};

			// ---- keys ----
			const onEscape = (event: KeyboardEvent | null) => {
				const result = $escape();
				if (result === null) return false;
				event?.preventDefault();
				if (result !== true) store.set({ anchorKey: result });
				return true;
			};
			const onArrow = (dir: -1 | 1) => (event: KeyboardEvent | null) => {
				const anchor = $stepSelection(dir, !!event?.shiftKey, store.get().anchorKey);
				if (anchor === undefined) return false;
				event?.preventDefault();
				store.set({ anchorKey: anchor });
				return true;
			};
			const consume = (action: () => boolean) => (event: KeyboardEvent | null) => {
				if (!action()) return false;
				event?.preventDefault();
				return true;
			};
			// Typing over a block selection does nothing (it would otherwise land somewhere odd).
			const onKey = (event: KeyboardEvent) => {
				if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return false;
				if ($selectedBlocks().length === 0) return false;
				event.preventDefault();
				return true;
			};

			// ---- marquee: drag from the page margin ----
			let drag: { x: number; y: number; moved: boolean } | null = null;
			const startsMarquee = (target: Element) =>
				!!options.marqueeArea && !!target.closest(options.marqueeArea) && !target.closest(ignore);

			const onPointerDown = (event: PointerEvent) => {
				if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
				if (!startsMarquee(event.target as Element)) return;
				// Only below the page head: the box selects editor blocks.
				const root = editor.getRootElement();
				if (!root || event.clientY < root.getBoundingClientRect().top - 8) return;
				event.preventDefault(); // no native text selection while drawing
				drag = { x: event.clientX, y: event.clientY, moved: false };
			};

			const onPointerMove = (event: PointerEvent) => {
				if (!drag) return;
				const dx = event.clientX - drag.x;
				const dy = event.clientY - drag.y;
				if (!drag.moved && Math.hypot(dx, dy) < 5) return;
				if (!drag.moved) {
					drag.moved = true;
					// Keys go to the editor afterwards (Backspace, arrows, ⌘C…).
					editor.getRootElement()?.focus({ preventScroll: true });
				}
				const box = {
					left: Math.min(drag.x, event.clientX),
					top: Math.min(drag.y, event.clientY),
					right: Math.max(drag.x, event.clientX),
					bottom: Math.max(drag.y, event.clientY),
				};
				store.set({ marquee: box });
				const root = editor.getRootElement();
				const elements = root ? blocksIn(root, box) : [];
				editor.update(() => store.set({ anchorKey: $selectElements(elements) }));
			};

			const onPointerUp = () => {
				if (!drag) return;
				const { moved } = drag;
				drag = null;
				store.set({ marquee: null });
				// A plain click in the margin clears a block selection.
				if (!moved)
					editor.update(() => {
						if ($isNodeSelection($getSelection())) $setSelection(null);
					});
			};

			return mergeRegister(
				editor.registerUpdateListener(paint),
				editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW),
				editor.registerCommand(KEY_ARROW_UP_COMMAND, onArrow(-1), COMMAND_PRIORITY_HIGH),
				editor.registerCommand(KEY_ARROW_DOWN_COMMAND, onArrow(1), COMMAND_PRIORITY_HIGH),
				editor.registerCommand(
					KEY_BACKSPACE_COMMAND,
					consume($deleteSelectedBlocks),
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_DELETE_COMMAND,
					consume($deleteSelectedBlocks),
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					consume($editFirstSelected),
					COMMAND_PRIORITY_HIGH,
				),
				editor.registerCommand(KEY_DOWN_COMMAND, onKey, COMMAND_PRIORITY_HIGH),
				listen(document, "pointerdown", onPointerDown),
				listen(document, "pointermove", onPointerMove),
				listen(document, "pointerup", onPointerUp),
				offRender,
				() => marquee.destroy(),
			);
		},
	};
}
