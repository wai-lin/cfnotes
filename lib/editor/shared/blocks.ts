/**
 * Block-level document operations shared by the block menu, shortcuts, block
 * selection and the insert commands. All `$` functions run inside
 * `editor.update` (or `read` for the queries).
 */
import {
	$generateJSONFromSelectedNodes,
	$generateNodesFromSerializedNodes,
} from "@lexical/clipboard";
import { $setBlocksType } from "@lexical/selection";
import {
	$createNodeSelection,
	$createParagraphNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isNodeSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isRootNode,
	$setSelection,
	type ElementNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type ParagraphNode,
} from "lexical";

/** The top-level block holding the selection. */
export function $selectedBlockKey(): NodeKey | null {
	const selection = $getSelection();
	if ($isRangeSelection(selection)) {
		const node = selection.anchor.getNode();
		return node.getTopLevelElement()?.getKey() ?? node.getKey();
	}
	if ($isNodeSelection(selection)) {
		const node = selection.getNodes()[0];
		return node ? (node.getTopLevelElement()?.getKey() ?? node.getKey()) : null;
	}
	return null;
}

/** The top-level block holding a range selection's anchor. */
export function $anchorBlock(): LexicalNode | null {
	const selection = $getSelection();
	return $isRangeSelection(selection) ? selection.anchor.getNode().getTopLevelElement() : null;
}

/** Whether `node` is a paragraph with nothing in it. */
export function $isEmptyParagraph(node: LexicalNode | null | undefined): node is ParagraphNode {
	return $isParagraphNode(node) && node.getTextContentSize() === 0;
}

/** Puts `node` in place of `block` when that's an empty line, otherwise after it. */
export function $replaceOrInsertAfter(block: LexicalNode, node: LexicalNode): void {
	if ($isEmptyParagraph(block)) block.replace(node);
	else block.insertAfter(node);
}

/** The line after `node`, made if there's none. */
export function $lineAfter(node: LexicalNode): LexicalNode {
	return node.getNextSibling() ?? node.insertAfter($createParagraphNode());
}

/** Keeps somewhere to write below `node` when it's the last block. */
export function $ensureLineAfter(node: LexicalNode): void {
	if (!node.getNextSibling()) node.insertAfter($createParagraphNode());
}

/** Inserts a copy of the block right after itself. */
export function $duplicateBlock(editor: LexicalEditor, key: NodeKey): void {
	const node = $getNodeByKey(key);
	if (!node) return;
	let after: LexicalNode = node;
	for (const copy of $copiesOf(editor, [key])) {
		after.insertAfter(copy);
		after = copy;
	}
	after.selectEnd();
}

/** Swaps the block with its previous (-1) or next (+1) sibling. */
export function $moveBlock(key: NodeKey, dir: -1 | 1): void {
	const node = $getNodeByKey(key);
	if (!node) return;
	const sibling = dir < 0 ? node.getPreviousSibling() : node.getNextSibling();
	if (!sibling) return;
	if (dir < 0) sibling.insertBefore(node);
	else sibling.insertAfter(node);
}

/** Removes the block, keeping the document non-empty. */
export function $removeBlock(key: NodeKey): void {
	$getNodeByKey(key)?.remove();
	$ensureNotEmpty();
}

/** An empty document still has a line to type on. */
export function $ensureNotEmpty(): void {
	const root = $getRoot();
	if (root.isEmpty()) root.append($createParagraphNode());
}

/**
 * Inserts blocks after `blockKey` (or at the selection; or at the end), replacing
 * an empty paragraph. Leaves a paragraph after them to keep writing in.
 */
export function $insertBlocks(nodes: LexicalNode[], blockKey: NodeKey | null): void {
	if (nodes.length === 0) return;
	let block = blockKey ? $getNodeByKey(blockKey) : null;
	if (!block) {
		const selection = $getSelection();
		block = $isRangeSelection(selection)
			? selection.anchor.getNode().getTopLevelElement()
			: $getRoot().getLastChild();
	}
	let last: LexicalNode | null = null;
	for (const node of nodes) {
		if (last) last.insertAfter(node);
		else if (block) $replaceOrInsertAfter(block, node);
		else $getRoot().append(node);
		last = node;
	}
	if (last) $ensureLineAfter(last);
	last?.getNextSibling()?.selectStart();
}

// ---- block selection (Notion's blue selection of whole blocks) ----

/** The top-level blocks of a node selection, in document order (empty for any other selection). */
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

/** Selects whole blocks. */
export function $selectBlocks(keys: NodeKey[]): void {
	if (keys.length === 0) return $setSelection(null);
	const selection = $createNodeSelection();
	for (const key of keys) selection.add(key);
	$setSelection(selection);
}

/** Removes blocks and puts the caret where they were. */
export function $removeBlocks(blocks: LexicalNode[]): void {
	if (blocks.length === 0) return;
	const before = blocks[0]?.getPreviousSibling() ?? null;
	const after = blocks.at(-1)?.getNextSibling() ?? null;
	for (const block of blocks) block.remove();
	const root = $getRoot();
	$ensureNotEmpty();
	if ($isElementNode(before)) before.selectEnd();
	else if ($isElementNode(after)) after.selectStart();
	else if (before || after) $selectBlocks([(before ?? after)?.getKey() ?? ""]);
	else root.getFirstChild()?.selectStart();
}

/** Copies the blocks after the last of them and selects the copies. */
export function $duplicateBlocks(editor: LexicalEditor, blocks: LexicalNode[]): void {
	const last = blocks.at(-1);
	if (!last) return;
	let after: LexicalNode = last;
	const copies: NodeKey[] = [];
	for (const copy of $copiesOf(
		editor,
		blocks.map((block) => block.getKey()),
	)) {
		after.insertAfter(copy);
		after = copy;
		copies.push(copy.getKey());
	}
	$selectBlocks(copies);
}

/** Moves the blocks together past their previous (-1) or next (+1) neighbour. */
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
 * Turns every text block in `blocks` into another type (`apply` is a block
 * item's), keeping them selected as blocks.
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

/** A block item's `apply` that turns the selected blocks into the ones `create` makes. */
export function setBlock(create: () => ElementNode): () => void {
	return () => {
		const selection = $getSelection();
		if ($isRangeSelection(selection)) $setBlocksType(selection, create);
	};
}

/** Fresh copies of the nodes with these keys (through the clipboard format). */
function $copiesOf(editor: LexicalEditor, keys: NodeKey[]): LexicalNode[] {
	const selection = $createNodeSelection();
	for (const key of keys) selection.add(key);
	const json = $generateJSONFromSelectedNodes(editor, selection);
	return $generateNodesFromSerializedNodes(json.nodes);
}
