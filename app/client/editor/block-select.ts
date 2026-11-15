import {
	$generateJSONFromSelectedNodes,
	$generateNodesFromSerializedNodes,
} from "@lexical/clipboard";
import { mergeRegister } from "@lexical/utils";
import {
	$createNodeSelection,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getRoot,
	$getSelection,
	$isDecoratorNode,
	$isElementNode,
	$isNodeSelection,
	$isRangeSelection,
	$isRootNode,
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
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";

/**
 * The top-level blocks of a node selection, in document order (empty for any
 * other selection). Call inside `editor.read`/`update`.
 */
export function $selectedBlocks(): LexicalNode[] {
	const selection = $getSelection();
	if (!$isNodeSelection(selection)) return [];
	// Blocks inside columns are their column's top level (columns are shadow roots).
	const blocks = new Map<NodeKey, LexicalNode>();
	for (const node of selection.getNodes()) {
		const block = node.getTopLevelElement() ?? node;
		blocks.set(block.getKey(), block);
	}
	return [...blocks.values()].sort((a, b) => (a === b ? 0 : a.isBefore(b) ? -1 : 1));
}

/** Selects whole blocks (Notion's blue block selection). Call inside `editor.update`. */
export function $selectBlocks(keys: NodeKey[]): void {
	if (keys.length === 0) return $setSelection(null);
	const selection = $createNodeSelection();
	for (const key of keys) selection.add(key);
	$setSelection(selection);
}

/** Removes blocks and puts the caret where they were. Call inside `editor.update`. */
export function $removeBlocks(blocks: LexicalNode[]): void {
	if (blocks.length === 0) return;
	const before = blocks[0]?.getPreviousSibling() ?? null;
	const after = blocks.at(-1)?.getNextSibling() ?? null;
	for (const block of blocks) block.remove();
	const root = $getRoot();
	if (root.isEmpty()) root.append($createParagraphNode());
	if ($isElementNode(before)) before.selectEnd();
	else if ($isElementNode(after)) after.selectStart();
	else if (before || after) $selectBlocks([(before ?? after)?.getKey() ?? ""]);
	else root.getFirstChild()?.selectStart();
}

/**
 * Block-level selection, like Notion's:
 * - Escape selects the block being edited; Escape again clears it.
 * - Dragging from the page margin draws a box that selects the blocks it crosses.
 * - With blocks selected: ↑/↓ move the selection, ⇧↑/⇧↓ grow or shrink it,
 *   Backspace/Delete removes them, Enter edits the first one. Copy, cut, ⌘D,
 *   ⌘⇧↑/↓ and the handle menu act on all of them.
 */
export function registerBlockSelect(editor: LexicalEditor): () => void {
	/** Where a shift-extension started, so ⇧↑ after ⇧↓ shrinks instead of growing. */
	let anchorKey: NodeKey | null = null;

	// ---- highlight ----
	let marked: HTMLElement[] = [];
	const paint = () => {
		const keys = editor.getEditorState().read(() => $selectedBlocks().map((b) => b.getKey()));
		for (const element of marked) element.classList.remove("blk-selected");
		marked = keys.flatMap((key) => editor.getElementByKey(key) ?? []);
		for (const element of marked) element.classList.add("blk-selected");
		if (keys.length === 0) anchorKey = null;
	};

	// ---- keys ----
	const onEscape = (event: KeyboardEvent | null) => {
		const selection = $getSelection();
		if ($isNodeSelection(selection)) {
			event?.preventDefault();
			$setSelection(null);
			return true;
		}
		if (!$isRangeSelection(selection)) return false;
		const block = selection.anchor.getNode().getTopLevelElement();
		if (!block) return false;
		event?.preventDefault();
		anchorKey = block.getKey();
		$selectBlocks([block.getKey()]);
		return true;
	};

	const onArrow = (dir: -1 | 1) => (event: KeyboardEvent | null) => {
		const blocks = $selectedBlocks();
		if (blocks.length === 0) return false;
		event?.preventDefault();
		// Siblings: the page's blocks, or a column's when the selection is inside one.
		const all = blocks[0]?.getParent()?.getChildren() ?? $getRoot().getChildren();
		const first = all.indexOf(blocks[0] as LexicalNode);
		const last = all.indexOf(blocks.at(-1) as LexicalNode);
		if (event?.shiftKey) {
			const anchor = anchorKey ? all.findIndex((b) => b.getKey() === anchorKey) : first;
			const from = anchor >= 0 ? anchor : first;
			// The moving end is whichever end isn't the anchor.
			const head = from === first ? last : first;
			const next = Math.min(all.length - 1, Math.max(0, head + dir));
			if (anchorKey === null) anchorKey = all[from]?.getKey() ?? null;
			const [lo, hi] = from <= next ? [from, next] : [next, from];
			$selectBlocks(all.slice(lo, hi + 1).map((b) => b.getKey()));
		} else {
			const target = all[Math.min(all.length - 1, Math.max(0, (dir < 0 ? first : last) + dir))];
			if (target) {
				anchorKey = target.getKey();
				$selectBlocks([target.getKey()]);
			}
		}
		return true;
	};

	const onDelete = (event: KeyboardEvent | null) => {
		const blocks = $selectedBlocks();
		if (blocks.length === 0) return false;
		event?.preventDefault();
		$removeBlocks(blocks);
		return true;
	};

	const onEnter = (event: KeyboardEvent | null) => {
		const blocks = $selectedBlocks();
		const first = blocks[0];
		// A single selected image/file keeps Lexical's own Enter (a line after it).
		if (!first || (blocks.length === 1 && $isDecoratorNode(first))) return false;
		event?.preventDefault();
		if ($isElementNode(first)) first.selectEnd();
		else first.insertAfter($createParagraphNode()).selectStart();
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
	const marquee = document.createElement("div");
	marquee.className = "blk-marquee";
	marquee.hidden = true;
	document.body.append(marquee);

	/** Pointerdowns that start a box: on the page around the editor, not on its controls or text. */
	const startsMarquee = (target: Element) =>
		!!target.closest(".main") &&
		!target.closest(
			".ne-content, .page-head, .page-title, .page-bar, .page-cover, .backlinks, button, input, a, textarea, select, dialog, [contenteditable='false'], .blk-handle, .fmt-bar, .slash-menu, cf-database",
		);

	let drag: { x: number; y: number; moved: boolean } | null = null;

	const blocksIn = (left: number, top: number, right: number, bottom: number) => {
		const root = editor.getRootElement();
		if (!root) return [];
		const hits: HTMLElement[] = [];
		for (const child of root.children) {
			if (child.matches("[data-lexical-decorator-boundary], [data-lexical-cursor]")) continue;
			const rect = child.getBoundingClientRect();
			if (rect.bottom >= top && rect.top <= bottom && rect.right >= left && rect.left <= right)
				hits.push(child as HTMLElement);
		}
		return hits;
	};

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
		const left = Math.min(drag.x, event.clientX);
		const top = Math.min(drag.y, event.clientY);
		const right = Math.max(drag.x, event.clientX);
		const bottom = Math.max(drag.y, event.clientY);
		Object.assign(marquee.style, {
			left: `${left}px`,
			top: `${top}px`,
			width: `${right - left}px`,
			height: `${bottom - top}px`,
		});
		marquee.hidden = false;
		const elements = blocksIn(left, top, right, bottom);
		editor.update(() => {
			const keys = elements.flatMap((element) => {
				const node = $getNearestNodeFromDOMNode(element);
				const block = node?.getTopLevelElement() ?? node;
				return block ? [block.getKey()] : [];
			});
			anchorKey = keys[0] ?? null;
			$selectBlocks(keys);
		});
	};

	const onPointerUp = () => {
		if (!drag) return;
		const { moved } = drag;
		drag = null;
		marquee.hidden = true;
		// A plain click in the margin clears a block selection.
		if (!moved)
			editor.update(() => {
				if ($isNodeSelection($getSelection())) $setSelection(null);
			});
	};

	document.addEventListener("pointerdown", onPointerDown);
	document.addEventListener("pointermove", onPointerMove);
	document.addEventListener("pointerup", onPointerUp);

	return mergeRegister(
		editor.registerUpdateListener(paint),
		editor.registerCommand(KEY_ESCAPE_COMMAND, onEscape, COMMAND_PRIORITY_LOW),
		editor.registerCommand(KEY_ARROW_UP_COMMAND, onArrow(-1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ARROW_DOWN_COMMAND, onArrow(1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_BACKSPACE_COMMAND, onDelete, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_DELETE_COMMAND, onDelete, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ENTER_COMMAND, onEnter, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_DOWN_COMMAND, onKey, COMMAND_PRIORITY_HIGH),
		() => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("pointermove", onPointerMove);
			document.removeEventListener("pointerup", onPointerUp);
			marquee.remove();
		},
	);
}

/** Copies the blocks after the last of them and selects the copies. Call inside `editor.update`. */
export function $duplicateBlocks(editor: LexicalEditor, blocks: LexicalNode[]): void {
	const last = blocks.at(-1);
	if (!last) return;
	const selection = $createNodeSelection();
	for (const block of blocks) selection.add(block.getKey());
	const json = $generateJSONFromSelectedNodes(editor, selection);
	let after: LexicalNode = last;
	const copies: NodeKey[] = [];
	for (const copy of $generateNodesFromSerializedNodes(json.nodes)) {
		after.insertAfter(copy);
		after = copy;
		copies.push(copy.getKey());
	}
	$selectBlocks(copies);
}

/** Moves the blocks together past their previous (-1) or next (+1) neighbour. Call inside `editor.update`. */
export function $moveBlocks(blocks: LexicalNode[], dir: -1 | 1): void {
	const first = blocks[0];
	const last = blocks.at(-1);
	if (!first || !last) return;
	const neighbour = dir < 0 ? first.getPreviousSibling() : last.getNextSibling();
	if (!neighbour) return;
	if (dir < 0) for (const block of blocks) neighbour.insertBefore(block);
	else for (const block of [...blocks].reverse()) neighbour.insertAfter(block);
	$selectBlocks(blocks.map((b) => b.getKey()));
}

/**
 * Turns every text block in `blocks` into another type (`apply` is a slash
 * menu item's), keeping them selected as blocks. Call inside `editor.update`.
 */
export function $turnBlocksInto(
	editor: LexicalEditor,
	blocks: LexicalNode[],
	apply: (editor: LexicalEditor) => void,
): void {
	const elements = blocks.filter($isElementNode);
	const first = elements[0];
	const last = elements.at(-1);
	if (!first || !last) return;
	// A range from the first block's start to the last one's end, as if dragged over.
	const { key, offset, type } = first.selectStart().anchor;
	last.selectEnd().anchor.set(key, offset, type);
	apply(editor);
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const keys = new Set(
		selection.getNodes().flatMap((node) => {
			const block = node.getTopLevelElement() ?? node;
			return $isRootNode(block) ? [] : [block.getKey()];
		}),
	);
	$selectBlocks(
		$getRoot()
			.getChildrenKeys()
			.filter((k) => keys.has(k)),
	);
}
