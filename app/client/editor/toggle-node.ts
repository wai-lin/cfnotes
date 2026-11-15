import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getSelection,
	$isDecoratorNode,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	ElementNode,
	type DOMConversionMap,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type RangeSelection,
	type SerializedElementNode,
	type Spread,
} from "lexical";

export type SerializedToggleNode = Spread<{ open: boolean }, SerializedElementNode>;

/**
 * A Notion-style toggle: `ToggleNode` holds a `ToggleTitleNode` (the always-visible
 * line) and a `ToggleBodyNode` (blocks shown only while open). The chevron is the
 * title's `::before`; clicks on it are caught in `registerToggles`.
 */
export class ToggleNode extends ElementNode {
	__open: boolean;

	static override getType(): string {
		return "toggle";
	}

	static override clone(node: ToggleNode): ToggleNode {
		return new ToggleNode(node.__open, node.__key);
	}

	static override importJSON(json: SerializedToggleNode): ToggleNode {
		return $createToggleNode(json.open).updateFromJSON(json);
	}

	constructor(open = true, key?: string) {
		super(key);
		this.__open = open;
	}

	getOpen(): boolean {
		return this.getLatest().__open;
	}

	setOpen(open: boolean): this {
		const writable = this.getWritable();
		writable.__open = open;
		return writable;
	}

	override exportJSON(): SerializedToggleNode {
		return { ...super.exportJSON(), open: this.getOpen() };
	}

	/** Pasted `<details>` (Notion copies toggles this way): summary → title, the rest → body. */
	static override importDOM(): DOMConversionMap {
		return {
			details: (domNode: HTMLElement) => ({
				priority: 1,
				conversion: () => ({
					node: $createToggleNode(domNode.hasAttribute("open")),
					after: (children) => {
						const title = children.find($isToggleTitleNode) ?? $createToggleTitleNode();
						const body = $createToggleBodyNode();
						let paragraph: ElementNode | null = null;
						for (const child of children) {
							if (child === title) continue;
							const block = ($isElementNode(child) || $isDecoratorNode(child)) && !child.isInline();
							if (block) {
								paragraph = null;
								body.append(child);
							} else {
								if (!paragraph) {
									paragraph = $createParagraphNode();
									body.append(paragraph);
								}
								paragraph.append(child);
							}
						}
						if (body.isEmpty()) body.append($createParagraphNode());
						return [title, body];
					},
				}),
			}),
		};
	}

	override exportDOM(): DOMExportOutput {
		const details = document.createElement("details");
		if (this.__open) details.open = true;
		return { element: details };
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-toggle";
		dom.classList.toggle("is-open", this.__open);
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__open !== this.__open) dom.classList.toggle("is-open", this.__open);
		return false;
	}

	override canBeEmpty(): boolean {
		return false;
	}
}

export class ToggleTitleNode extends ElementNode {
	static override getType(): string {
		return "toggle-title";
	}

	static override clone(node: ToggleTitleNode): ToggleTitleNode {
		return new ToggleTitleNode(node.__key);
	}

	static override importJSON(json: SerializedElementNode): ToggleTitleNode {
		return $createToggleTitleNode().updateFromJSON(json);
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-toggle-title";
		return dom;
	}

	static override importDOM(): DOMConversionMap {
		return {
			summary: () => ({
				priority: 1,
				conversion: () => ({
					node: $createToggleTitleNode(),
					// A title is one line: lift text out of any blocks inside <summary>.
					after: (children) =>
						children.flatMap((child) =>
							$isElementNode(child) && !child.isInline() ? child.getChildren() : [child],
						),
				}),
			}),
		};
	}

	override exportDOM(): DOMExportOutput {
		return { element: document.createElement("summary") };
	}

	override updateDOM(): boolean {
		return false;
	}

	/** Enter: into the body while open, below the toggle while closed. */
	override insertNewAfter(_selection: RangeSelection, restoreSelection = true): ElementNode {
		const toggle = this.getParentOrThrow();
		if ($isToggleNode(toggle) && toggle.getOpen()) {
			const body = this.getNextSibling();
			if ($isToggleBodyNode(body)) {
				const first = body.getFirstChild();
				if ($isElementNode(first)) return first;
				const paragraph = $createParagraphNode();
				body.append(paragraph);
				return paragraph;
			}
		}
		const paragraph = $createParagraphNode();
		toggle.insertAfter(paragraph, restoreSelection);
		return paragraph;
	}

	/** Backspace at the start unwraps the whole toggle. */
	override collapseAtStart(): boolean {
		const toggle = this.getParentOrThrow();
		if (!$isToggleNode(toggle)) return false;
		const paragraph = $createParagraphNode();
		paragraph.append(...this.getChildren());
		const body = toggle.getChildren().find($isToggleBodyNode);
		toggle.insertBefore(paragraph);
		for (const child of body?.getChildren() ?? []) toggle.insertBefore(child);
		toggle.remove();
		paragraph.select(0, 0);
		return true;
	}
}

export class ToggleBodyNode extends ElementNode {
	static override getType(): string {
		return "toggle-body";
	}

	static override clone(node: ToggleBodyNode): ToggleBodyNode {
		return new ToggleBodyNode(node.__key);
	}

	static override importJSON(json: SerializedElementNode): ToggleBodyNode {
		return $createToggleBodyNode().updateFromJSON(json);
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-toggle-body";
		return dom;
	}

	override updateDOM(): boolean {
		return false;
	}
}

export function $createToggleNode(open = true): ToggleNode {
	return $applyNodeReplacement(new ToggleNode(open));
}

export function $createToggleTitleNode(): ToggleTitleNode {
	return $applyNodeReplacement(new ToggleTitleNode());
}

export function $createToggleBodyNode(): ToggleBodyNode {
	return $applyNodeReplacement(new ToggleBodyNode());
}

export function $isToggleNode(node: LexicalNode | null | undefined): node is ToggleNode {
	return node instanceof ToggleNode;
}

export function $isToggleTitleNode(node: LexicalNode | null | undefined): node is ToggleTitleNode {
	return node instanceof ToggleTitleNode;
}

export function $isToggleBodyNode(node: LexicalNode | null | undefined): node is ToggleBodyNode {
	return node instanceof ToggleBodyNode;
}

/** Turns the block the selection is in into a toggle, keeping its text as the title. */
export function $insertToggle(): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const block = selection.anchor.getNode().getTopLevelElement();
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

/** Chevron clicks, plus transforms that keep a toggle's title+body structure intact. */
export function registerToggles(editor: LexicalEditor): () => void {
	const onClick = (event: MouseEvent) => {
		const root = editor.getRootElement();
		const title = (event.target as Element).closest<HTMLElement>(".ne-toggle-title");
		if (!title || !root?.contains(title)) return;
		// Only the chevron zone toggles; the rest of the line is for editing.
		if (event.clientX - title.getBoundingClientRect().left > 26) return;
		event.preventDefault();
		editor.update(() => {
			const node = $getNearestNodeFromDOMNode(title);
			const toggle = $isToggleTitleNode(node) ? node.getParent() : null;
			if ($isToggleNode(toggle)) toggle.setOpen(!toggle.getOpen());
		});
	};
	document.addEventListener("click", onClick);

	const offToggle = editor.registerNodeTransform(ToggleNode, (node) => {
		const children = node.getChildren();
		if (children.length === 2 && $isToggleTitleNode(children[0]) && $isToggleBodyNode(children[1]))
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
	});

	const offTitle = editor.registerNodeTransform(ToggleTitleNode, (node) => {
		if ($isToggleNode(node.getParent())) return;
		const paragraph = $createParagraphNode();
		paragraph.append(...node.getChildren());
		node.replace(paragraph);
	});

	const offBody = editor.registerNodeTransform(ToggleBodyNode, (node) => {
		if (!$isToggleNode(node.getParent())) {
			for (const child of node.getChildren()) node.insertBefore(child);
			node.remove();
		} else if (node.isEmpty()) {
			node.append($createParagraphNode());
		}
	});

	return () => {
		document.removeEventListener("click", onClick);
		offToggle();
		offTitle();
		offBody();
	};
}
