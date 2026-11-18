import { mergeRegister } from "@lexical/utils";
import {
	$getRoot,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	BLUR_COMMAND,
	COMMAND_PRIORITY_LOW,
	FOCUS_COMMAND,
	type NodeKey,
} from "lexical";

import type { EditorExtension } from "../../core/extension";
import { $isEmptyParagraph } from "../../shared/blocks";

export interface PlaceholderOptions {
	/** On the empty line holding the caret. */
	line?: string;
	/** On an empty document, focused or not. */
	empty?: string;
}

/** Which line gets a hint, and which one. Call inside `editor.read`. */
function $placeholderFor(
	focused: boolean,
	hints: Required<PlaceholderOptions>,
): { key: NodeKey; hint: string } | null {
	const root = $getRoot();
	const only = root.getChildrenSize() === 1 ? root.getFirstChild() : null;
	if ($isParagraphNode(only) && only.getTextContentSize() === 0)
		return { key: only.getKey(), hint: hints.empty };
	if (!focused) return null;
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
	const block = selection.anchor.getNode().getTopLevelElement();
	return block && $isEmptyParagraph(block) ? { key: block.getKey(), hint: hints.line } : null;
}

/**
 * Notion-style placeholders: the empty line holding the caret gets a hint
 * (`data-placeholder`, drawn by CSS), and an empty page shows one even when
 * the editor isn't focused.
 */
export function placeholderExtension(options: PlaceholderOptions = {}): EditorExtension {
	const hints = {
		line: options.line ?? "Type '/' for commands",
		empty: options.empty ?? "Write something, or press '/' for commands…",
	};
	return {
		name: "placeholder",
		register({ editor }) {
			let marked: HTMLElement | null = null;
			let focused = false;

			const refresh = () => {
				const found = editor.getEditorState().read(() => $placeholderFor(focused, hints));
				const element = found ? editor.getElementByKey(found.key) : null;
				if (marked && marked !== element) delete marked.dataset.placeholder;
				if (element && found) element.dataset.placeholder = found.hint;
				marked = element;
			};
			const focus = (value: boolean) => () => {
				focused = value;
				refresh();
				return false;
			};

			return mergeRegister(
				editor.registerUpdateListener(refresh),
				editor.registerCommand(FOCUS_COMMAND, focus(true), COMMAND_PRIORITY_LOW),
				editor.registerCommand(BLUR_COMMAND, focus(false), COMMAND_PRIORITY_LOW),
			);
		},
	};
}
