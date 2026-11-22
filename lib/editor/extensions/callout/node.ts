import {
	$applyNodeReplacement,
	$createParagraphNode,
	ElementNode,
	type EditorConfig,
	type LexicalNode,
	type ParagraphNode,
	type RangeSelection,
	type SerializedElementNode,
	type Spread,
} from "lexical";

export type SerializedCalloutNode = Spread<{ emoji: string }, SerializedElementNode>;

const DEFAULT_EMOJI = "💡";

/** A Notion-style callout: an emoji beside text on a tinted background. */
export class CalloutNode extends ElementNode {
	__emoji: string;

	static override getType(): string {
		return "callout";
	}

	static override clone(node: CalloutNode): CalloutNode {
		return new CalloutNode(node.__emoji, node.__key);
	}

	static override importJSON(json: SerializedCalloutNode): CalloutNode {
		return $createCalloutNode(json.emoji).updateFromJSON(json);
	}

	constructor(emoji = DEFAULT_EMOJI, key?: string) {
		super(key);
		this.__emoji = emoji;
	}

	getEmoji(): string {
		return this.getLatest().__emoji;
	}

	setEmoji(emoji: string): this {
		const writable = this.getWritable();
		writable.__emoji = emoji;
		return writable;
	}

	override exportJSON(): SerializedCalloutNode {
		return { ...super.exportJSON(), emoji: this.getEmoji() };
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-callout";
		dom.dataset.emoji = this.__emoji;
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__emoji !== this.__emoji) dom.dataset.emoji = this.__emoji;
		return false;
	}

	/** Enter at the end leaves the callout. */
	override insertNewAfter(_selection: RangeSelection, restoreSelection = true): ParagraphNode {
		const paragraph = $createParagraphNode();
		this.insertAfter(paragraph, restoreSelection);
		return paragraph;
	}

	/** Backspace at the start turns it back into a paragraph. */
	override collapseAtStart(): boolean {
		const paragraph = $createParagraphNode();
		paragraph.append(...this.getChildren());
		this.replace(paragraph);
		return true;
	}
}

export function $createCalloutNode(emoji = DEFAULT_EMOJI): CalloutNode {
	return $applyNodeReplacement(new CalloutNode(emoji));
}

export function $isCalloutNode(node: LexicalNode | null | undefined): node is CalloutNode {
	return node instanceof CalloutNode;
}
