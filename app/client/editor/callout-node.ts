import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	ElementNode,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type ParagraphNode,
	type RangeSelection,
	type SerializedElementNode,
	type Spread,
} from "lexical";

export type SerializedCalloutNode = Spread<{ emoji: string }, SerializedElementNode>;

const DEFAULT_EMOJI = "💡";
const EMOJI_CHOICES = ["💡", "📌", "✅", "⚠️", "❗", "🔥", "📝", "⭐", "💬", "🎯", "🚀", "❓"];

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

/** Clicking a callout's emoji opens a small picker to change it. */
export function registerCallouts(editor: LexicalEditor): () => void {
	const picker = document.createElement("div");
	picker.className = "emoji-pick";
	picker.hidden = true;
	picker.setAttribute("role", "listbox");
	document.body.append(picker);

	let forKey: string | null = null;

	const close = () => {
		picker.hidden = true;
		forKey = null;
	};

	const open = (key: string, at: DOMRect) => {
		forKey = key;
		picker.replaceChildren(
			...EMOJI_CHOICES.map((emoji) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "emoji-item";
				button.textContent = emoji;
				button.addEventListener("click", () => {
					editor.update(() => {
						const node = $getNodeByKey(forKey ?? "");
						if ($isCalloutNode(node)) node.setEmoji(emoji);
					});
					close();
				});
				return button;
			}),
		);
		picker.hidden = false;
		const top = at.bottom + 4;
		picker.style.top = `${top + picker.offsetHeight < innerHeight ? top : Math.max(8, at.top - picker.offsetHeight - 4)}px`;
		picker.style.left = `${Math.max(8, Math.min(at.left, innerWidth - picker.offsetWidth - 8))}px`;
	};

	const onClick = (event: MouseEvent) => {
		const root = editor.getRootElement();
		const callout = (event.target as Element).closest<HTMLElement>(".ne-callout");
		if (!callout || !root?.contains(callout)) return;
		// Only clicks on the emoji itself (the ::before in the left padding).
		const rect = callout.getBoundingClientRect();
		if (event.clientX - rect.left > 44) return;
		event.preventDefault();
		const key = editor.read(() => {
			const node = $getNearestNodeFromDOMNode(callout);
			return $isCalloutNode(node) ? node.getKey() : null;
		});
		if (key) open(key, new DOMRect(rect.left + 10, rect.top + 8, 28, 28));
	};

	const onOutside = (event: PointerEvent) => {
		if (!picker.hidden && !picker.contains(event.target as Node)) close();
	};

	document.addEventListener("click", onClick);
	document.addEventListener("pointerdown", onOutside, true);
	return () => {
		document.removeEventListener("click", onClick);
		document.removeEventListener("pointerdown", onOutside, true);
		picker.remove();
	};
}
