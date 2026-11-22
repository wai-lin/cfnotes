import { mergeRegister } from "@lexical/utils";
import {
	$createNodeSelection,
	$getNearestNodeFromDOMNode,
	$getSelection,
	$isNodeSelection,
	$setSelection,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";

import { listen } from "./dom.ts";

/**
 * Clicking a decorator block (matched by `selector`, except links, inputs and
 * resize handles inside it) selects its node, so Backspace deletes it; the
 * selected block gets an `is-selected` class as the ring.
 */
export function registerClickSelect(
	editor: LexicalEditor,
	host: HTMLElement,
	selector: string,
	guard: (node: LexicalNode | null) => node is LexicalNode,
): () => void {
	const onClick = (event: MouseEvent) => {
		const target = event.target as Element;
		const block = target.closest<HTMLElement>(selector);
		if (!block || !editor.getRootElement()?.contains(block)) return;
		if (target.closest("a, input, .ne-image-handle")) return;
		editor.update(() => {
			const node = $getNearestNodeFromDOMNode(block);
			if (!guard(node)) return;
			const selection = $createNodeSelection();
			selection.add(node.getKey());
			$setSelection(selection);
		});
	};

	return mergeRegister(
		listen(host, "click", onClick),
		registerSelectedClass(editor, guard, "is-selected"),
	);
}

/** Keeps `className` on the elements of the selected nodes that pass `guard`. */
export function registerSelectedClass(
	editor: LexicalEditor,
	guard: (node: LexicalNode) => boolean,
	className: string,
): () => void {
	let marked: HTMLElement[] = [];
	return editor.registerUpdateListener(() => {
		const keys = editor.getEditorState().read(() => {
			const selection = $getSelection();
			return $isNodeSelection(selection)
				? selection
						.getNodes()
						.filter((node) => guard(node))
						.map((node) => node.getKey())
				: [];
		});
		for (const element of marked) element.classList.remove(className);
		marked = keys.flatMap((key) => editor.getElementByKey(key) ?? []);
		for (const element of marked) element.classList.add(className);
	});
}
