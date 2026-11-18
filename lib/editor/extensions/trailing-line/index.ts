/**
 * A way out of the last block. Code blocks, tables, callouts, toggles, quotes,
 * columns and the like keep Enter for themselves, so when one is the last block
 * on the page there would be nowhere below it to type. Two ways to get there:
 *
 * - ArrowDown (or ArrowRight) when the caret can't go any further in the last
 *   block starts a new line below it;
 * - a click in the space under the last block does too (or moves to the empty
 *   line that's already there).
 *
 * And a caret left past the last block (tables put it there) gets a line too.
 */
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isDecoratorNode,
	$isNodeSelection,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_RIGHT_COMMAND,
	mergeRegister,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";

import type { EditorExtension } from "../../core/extension";

/** The last top-level block, when it isn't a paragraph you can already type in. */
function $trappingBlock(): LexicalNode | null {
	const last = $getRoot().getLastChild();
	return last && !$isParagraphNode(last) ? last : null;
}

/** Starts an empty line after the last block and puts the caret there. */
function $addLineBelow(): void {
	const block = $trappingBlock();
	if (!block) return;
	const paragraph = $createParagraphNode();
	block.insertAfter(paragraph);
	paragraph.select();
}

type Snapshot = [Node | null, number, Node | null, number];
const snapshot = (): Snapshot => {
	const sel = getSelection();
	return [
		sel?.anchorNode ?? null,
		sel?.anchorOffset ?? 0,
		sel?.focusNode ?? null,
		sel?.focusOffset ?? 0,
	];
};
const same = (a: Snapshot, b: Snapshot) => a.every((value, i) => value === b[i]);

function registerTrailingLine(editor: LexicalEditor): () => void {
	const onArrow = (event: KeyboardEvent | null): boolean => {
		if (event && (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey)) return false;
		const selection = $getSelection();
		// A selected image, embed, equation… at the end: straight to a new line.
		if ($isNodeSelection(selection)) {
			const nodes = selection.getNodes();
			const block = $trappingBlock();
			if (nodes.length === 1 && block && $isDecoratorNode(nodes[0]) && nodes[0]!.is(block)) {
				event?.preventDefault();
				$addLineBelow();
				return true;
			}
			return false;
		}
		if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
		const block = $trappingBlock();
		const top = selection.anchor.getNode().getTopLevelElement();
		if (!block || !top?.is(block)) return false;
		// Let the caret move as it would; if it couldn't, it's at the bottom.
		const before = snapshot();
		setTimeout(() => {
			if (!same(before, snapshot())) return;
			editor.update(() => {
				const now = $getSelection();
				if (!$isRangeSelection(now) || !now.isCollapsed()) return;
				const block = $trappingBlock();
				if (block && now.anchor.getNode().getTopLevelElement()?.is(block)) $addLineBelow();
			});
		});
		return false;
	};

	/** A press in the empty space under the last block (the editor's bottom padding). */
	const onMouseDown = (event: MouseEvent) => {
		const root = editor.getRootElement();
		if (event.button !== 0 || !root || event.target !== root) return;
		const last = root.lastElementChild;
		if (last && event.clientY <= last.getBoundingClientRect().bottom) return;
		event.preventDefault();
		editor.update(() => {
			const lastNode = $getRoot().getLastChild();
			if ($isParagraphNode(lastNode) && lastNode.getTextContentSize() === 0) lastNode.select();
			else if ($trappingBlock()) $addLineBelow();
			else lastNode?.selectEnd();
		});
		editor.focus();
	};

	const offRoot = editor.registerRootListener((root, previous) => {
		previous?.removeEventListener("mousedown", onMouseDown);
		root?.addEventListener("mousedown", onMouseDown);
	});

	/**
	 * Some blocks (tables) move the caret past themselves on their own, to the
	 * end of the page where there's no line: make one there.
	 */
	const offUpdate = editor.registerUpdateListener(({ editorState }) => {
		const stranded = editorState.read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
			const { anchor } = selection;
			const root = $getRoot();
			return (
				anchor.type === "element" &&
				anchor.key === root.getKey() &&
				anchor.offset === root.getChildrenSize() &&
				$trappingBlock() !== null
			);
		});
		if (stranded) editor.update($addLineBelow);
	});

	return mergeRegister(
		offUpdate,
		editor.registerCommand(KEY_ARROW_DOWN_COMMAND, onArrow, COMMAND_PRIORITY_LOW),
		editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, onArrow, COMMAND_PRIORITY_LOW),
		offRoot,
		() => editor.getRootElement()?.removeEventListener("mousedown", onMouseDown),
	);
}

/** A way out of the last block (see above). */
export function trailingLineExtension(): EditorExtension {
	return { name: "trailing-line", register: ({ editor }) => registerTrailingLine(editor) };
}
