import { mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$isElementNode,
	$isParagraphNode,
	type LexicalEditor,
} from "lexical";

import { $anchorBlock } from "../../shared/blocks";
import {
	$createToggleBodyNode,
	$createToggleNode,
	$createToggleTitleNode,
	$isToggleBodyNode,
	$isToggleNode,
	$isToggleTitleNode,
	ToggleBodyNode,
	ToggleNode,
	ToggleTitleNode,
} from "./node";

/** Turns the block the selection is in into a toggle, keeping its text as the title. */
export function $insertToggle(): void {
	const block = $anchorBlock();
	if (!block || !$isElementNode(block)) return;
	const title = $createToggleTitleNode();
	const body = $createToggleBodyNode();
	body.append($createParagraphNode());
	const toggle = $createToggleNode(true);
	toggle.append(title, body);
	if ($isParagraphNode(block)) {
		title.append(...block.getChildren());
		block.replace(toggle);
	} else {
		block.insertAfter(toggle);
	}
	title.select();
}

/** Opens or closes the toggle whose title is `title`. */
export function $flipToggleAt(title: HTMLElement): void {
	const node = $getNearestNodeFromDOMNode(title);
	const toggle = $isToggleTitleNode(node) ? node.getParent() : null;
	if ($isToggleNode(toggle)) toggle.setOpen(!toggle.getOpen());
}

/** Transforms that keep a toggle's title + body structure intact. */
export function registerToggleRepairs(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerNodeTransform(ToggleNode, (node) => {
			const children = node.getChildren();
			if (
				children.length === 2 &&
				$isToggleTitleNode(children[0]) &&
				$isToggleBodyNode(children[1])
			)
				return;
			// Damaged (a merge, a paste, a partial delete): unwrap what's left.
			for (const child of children) {
				if ($isToggleTitleNode(child) || $isToggleBodyNode(child)) {
					for (const inner of child.getChildren()) node.insertBefore(inner);
					child.remove();
				} else {
					node.insertBefore(child);
				}
			}
			node.remove();
		}),
		editor.registerNodeTransform(ToggleTitleNode, (node) => {
			if ($isToggleNode(node.getParent())) return;
			const paragraph = $createParagraphNode();
			paragraph.append(...node.getChildren());
			node.replace(paragraph);
		}),
		editor.registerNodeTransform(ToggleBodyNode, (node) => {
			if (!$isToggleNode(node.getParent())) {
				for (const child of node.getChildren()) node.insertBefore(child);
				node.remove();
			} else if (node.isEmpty()) {
				node.append($createParagraphNode());
			}
		}),
	);
}
