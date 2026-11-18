import { $dfs } from "@lexical/utils";
import { $getNodeByKey, $getRoot, $isElementNode, type NodeKey } from "lexical";

import { $ensureNotEmpty, $lineAfter, $replaceOrInsertAfter } from "../../shared/blocks";
import { $createDatabaseNode, $isDatabaseNode } from "./node";

/** Where a removed block was, to put it back. */
export interface Spot {
	parent: NodeKey;
	index: number;
}

/** Puts a block for database `id` after `blockKey` (in place of an empty line), or at the end. */
export function $insertDatabase(id: string, blockKey: NodeKey | null): void {
	const node = $createDatabaseNode(id);
	const block = blockKey ? $getNodeByKey(blockKey) : null;
	if (block) $replaceOrInsertAfter(block, node);
	else $getRoot().append(node);
	// Leave somewhere to keep writing below.
	$lineAfter(node).selectStart();
}

/** Removes every block for database `id`; returns where the first one was. */
export function $removeDatabase(id: string): Spot | null {
	let spot: Spot | null = null;
	for (const { node } of $dfs()) {
		if (!$isDatabaseNode(node) || node.getDatabaseId() !== id) continue;
		const parent = node.getParent();
		if (parent && !spot) spot = { parent: parent.getKey(), index: node.getIndexWithinParent() };
		node.remove();
	}
	$ensureNotEmpty();
	return spot;
}

/** Puts a block for database `id` back where it was (or at the end). */
export function $restoreDatabase(id: string, spot: Spot | null): void {
	const node = $createDatabaseNode(id);
	const parent = spot ? $getNodeByKey(spot.parent) : null;
	if ($isElementNode(parent) && parent.isAttached() && spot) {
		const before = parent.getChildAtIndex(spot.index);
		if (before) before.insertBefore(node);
		else parent.append(node);
	} else $getRoot().append(node);
	if (!node.getNextSibling()) $lineAfter(node);
}
