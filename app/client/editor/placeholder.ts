import { mergeRegister } from "@lexical/utils";
import {
	$getRoot,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	BLUR_COMMAND,
	COMMAND_PRIORITY_LOW,
	FOCUS_COMMAND,
	type LexicalEditor,
} from "lexical";

const LINE_HINT = "Type '/' for commands";
const EMPTY_HINT = "Write something, or press '/' for commands…";

/**
 * Notion-style placeholders: the empty line holding the cursor gets a hint,
 * and an empty page shows one even when the editor is not focused.
 */
export function registerPlaceholder(editor: LexicalEditor): () => void {
	let marked: HTMLElement | null = null;
	let focused = false;

	const refresh = () => {
		let key: string | null = null;
		let hint = LINE_HINT;
		editor.getEditorState().read(() => {
			const root = $getRoot();
			const only = root.getChildrenSize() === 1 ? root.getFirstChild() : null;
			if ($isParagraphNode(only) && only.getTextContentSize() === 0) {
				key = only.getKey();
				hint = EMPTY_HINT;
				return;
			}
			if (!focused) return;
			const selection = $getSelection();
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
			const block = selection.anchor.getNode().getTopLevelElement();
			if ($isParagraphNode(block) && block.getTextContentSize() === 0) key = block.getKey();
		});

		const element = key ? editor.getElementByKey(key) : null;
		if (marked && marked !== element) delete marked.dataset.placeholder;
		if (element) element.dataset.placeholder = hint;
		marked = element;
	};

	return mergeRegister(
		editor.registerUpdateListener(refresh),
		editor.registerCommand(
			FOCUS_COMMAND,
			() => {
				focused = true;
				refresh();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
		editor.registerCommand(
			BLUR_COMMAND,
			() => {
				focused = false;
				refresh();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
	);
}
