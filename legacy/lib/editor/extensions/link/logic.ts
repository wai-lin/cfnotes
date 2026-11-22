import { $isLinkNode, type LinkNode } from "@lexical/link";
import { $findMatchingParent } from "@lexical/utils";
import {
	$getNearestNodeFromDOMNode,
	$getSelection,
	$isRangeSelection,
	type RangeSelection,
} from "lexical";

export const URL_LIKE = /^(https?:\/\/|mailto:|tel:)\S+$/i;
const BARE_URL = /^[\w-]+(\.[\w-]+)+(\/\S*)?$/;

/** A typed or pasted link as a URL (`example.com` → `https://example.com`), or null. */
export function normalizeUrl(raw: string): string | null {
	const url = raw.trim();
	if (!url) return null;
	if (URL_LIKE.test(url)) return url;
	if (BARE_URL.test(url)) return `https://${url}`;
	return null;
}

/** The link the selection's anchor is in. Call inside `editor.read`/`update`. */
export function $linkAtSelection(): LinkNode | null {
	const selection = $getSelection();
	return $isRangeSelection(selection)
		? $findMatchingParent(selection.anchor.getNode(), $isLinkNode)
		: null;
}

/** The link node of a link's DOM element. */
export function $linkOfElement(anchor: HTMLElement): LinkNode | null {
	const node = $getNearestNodeFromDOMNode(anchor);
	return node ? ($isLinkNode(node) ? node : $findMatchingParent(node, $isLinkNode)) : null;
}

/**
 * Selects what a link edit applies to: the whole link when inside one,
 * otherwise the selected text. Returns a copy of that selection and the link's
 * current URL, or null when there's nothing to link. Call inside `editor.update`.
 */
export function $selectLinkTarget(
	link: LinkNode | null = $linkAtSelection(),
): { selection: RangeSelection; url: string } | null {
	if (link) link.select(0, link.getChildrenSize());
	else {
		const selection = $getSelection();
		if (!$isRangeSelection(selection) || selection.isCollapsed()) return null; // nothing to link
	}
	const live = $getSelection();
	return $isRangeSelection(live) ? { selection: live.clone(), url: link?.getURL() ?? "" } : null;
}
