import {
	$createTextNode,
	$getAdjacentNode,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
} from "lexical";

import { $createPageLinkNode, $isPageLinkNode } from "./node";

/** Inserts a link at the selection and leaves the caret after it, ready to type. */
export function $insertPageLink(pageId: string): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const link = $createPageLinkNode(pageId);
	selection.insertNodes([link]);
	const next = link.getNextSibling();
	if ($isTextNode(next) && /^\s/.test(next.getTextContent())) {
		next.select(1, 1);
	} else {
		const space = $createTextNode(" ");
		link.insertAfter(space);
		space.select(1, 1);
	}
}

/**
 * Steps the caret over a page link next to it in one key press (browsers move
 * unreliably across a non-editable inline element). False when there's none.
 */
export function $hopOverPageLink(backward: boolean): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
	const node = $getAdjacentNode(selection.focus, backward);
	if (!$isPageLinkNode(node)) return false;
	if (backward) node.selectPrevious();
	else node.selectNext(0, 0);
	return true;
}
