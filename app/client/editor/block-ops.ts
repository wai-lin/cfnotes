import {
	$generateJSONFromSelectedNodes,
	$generateNodesFromSerializedNodes,
} from "@lexical/clipboard";
import {
	$createNodeSelection,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isNodeSelection,
	$isParagraphNode,
	$isRangeSelection,
	$setSelection,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";

/** The top-level block holding the selection. Call inside `editor.update`/`read`. */
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

/** Inserts a copy of the block right after itself. Call inside `editor.update`. */
export function $duplicateBlock(editor: LexicalEditor, key: NodeKey): void {
	const node = $getNodeByKey(key);
	if (!node) return;
	const selection = $createNodeSelection();
	selection.add(key);
	const json = $generateJSONFromSelectedNodes(editor, selection);
	let after: LexicalNode = node;
	for (const copy of $generateNodesFromSerializedNodes(json.nodes)) {
		after.insertAfter(copy);
		after = copy;
	}
	after.selectEnd();
}

/** Swaps the block with its previous (-1) or next (+1) sibling. Call inside `editor.update`. */
export function $moveBlock(key: NodeKey, dir: -1 | 1): void {
	const node = $getNodeByKey(key);
	if (!node) return;
	const sibling = dir < 0 ? node.getPreviousSibling() : node.getNextSibling();
	if (!sibling) return;
	if (dir < 0) sibling.insertBefore(node);
	else sibling.insertAfter(node);
}

/** Removes the block, keeping the document non-empty. Call inside `editor.update`. */
export function $removeBlock(key: NodeKey): void {
	$getNodeByKey(key)?.remove();
	const root = $getRoot();
	if (root.isEmpty()) root.append($createParagraphNode());
}

/**
 * Inserts blocks after `blockKey` (or at the selection; or at the end), replacing
 * an empty paragraph. Leaves a paragraph after them to keep writing in.
 * Call inside `editor.update`.
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
		else if (block && $isParagraphNode(block) && block.getTextContentSize() === 0)
			block.replace(node);
		else if (block) block.insertAfter(node);
		else $getRoot().append(node);
		last = node;
	}
	if (last && !last.getNextSibling()) last.insertAfter($createParagraphNode());
	last?.getNextSibling()?.selectStart();
}

/**
 * Clicking a decorator block (matched by `selector`, except links and the resize
 * handle inside it) selects its node, so Backspace deletes it; the selected
 * block gets an `is-selected` class as the ring.
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
	host.addEventListener("click", onClick);

	let marked: HTMLElement[] = [];
	const markSelected = () => {
		const keys = editor.getEditorState().read(() => {
			const selection = $getSelection();
			return $isNodeSelection(selection)
				? selection
						.getNodes()
						.filter((node) => guard(node))
						.map((node) => node.getKey())
				: [];
		});
		for (const element of marked) element.classList.remove("is-selected");
		marked = keys.flatMap((key) => editor.getElementByKey(key) ?? []);
		for (const element of marked) element.classList.add("is-selected");
	};
	const offUpdates = editor.registerUpdateListener(markSelected);

	return () => {
		host.removeEventListener("click", onClick);
		offUpdates();
	};
}
