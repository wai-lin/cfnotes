import type { MultilineElementTransformer, TextMatchTransformer } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";
import {
	$createNodeSelection,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getSelection,
	$isNodeSelection,
	$isRangeSelection,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	DecoratorNode,
	KEY_ENTER_COMMAND,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { $insertBlocks, $selectedBlockKey, registerClickSelect } from "./block-ops";
import { renderMath } from "./katex-lazy";

export type SerializedEquationNode = Spread<
	{ equation: string; inline: boolean },
	SerializedLexicalNode
>;

const MAX_EQUATION = 4000;

/**
 * A TeX equation rendered with KaTeX: inline inside a line of text, or a
 * centered block of its own. Clicking it opens a small editor below it.
 */
export class EquationNode extends DecoratorNode<null> {
	__equation: string;
	__inline: boolean;

	static override getType(): string {
		return "equation";
	}

	static override clone(node: EquationNode): EquationNode {
		return new EquationNode(node.__equation, node.__inline, node.__key);
	}

	static override importJSON(json: SerializedEquationNode): EquationNode {
		return $createEquationNode(json.equation, json.inline).updateFromJSON(json);
	}

	constructor(equation = "", inline = false, key?: NodeKey) {
		super(key);
		this.__equation = equation.slice(0, MAX_EQUATION);
		this.__inline = inline;
	}

	getEquation(): string {
		return this.__equation;
	}

	setEquation(equation: string): this {
		const writable = this.getWritable();
		writable.__equation = equation.slice(0, MAX_EQUATION);
		return writable;
	}

	override exportJSON(): SerializedEquationNode {
		return { ...super.exportJSON(), equation: this.__equation, inline: this.__inline };
	}

	/** Copying out to other apps: the TeX source, as markdown-style math. */
	override exportDOM(): DOMExportOutput {
		const element = document.createElement(this.__inline ? "span" : "div");
		element.textContent = this.__inline ? `$$${this.__equation}$$` : `$$\n${this.__equation}\n$$`;
		return { element };
	}

	override getTextContent(): string {
		return this.__equation;
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const wrap = document.createElement(this.__inline ? "span" : "div");
		wrap.className = `ne-eq ${this.__inline ? "ne-eq-inline" : "ne-eq-block"}`;
		wrap.contentEditable = "false";
		const math = document.createElement(this.__inline ? "span" : "div");
		math.className = "ne-eq-math";
		wrap.append(math);
		draw(wrap, this.__equation, !this.__inline);
		return wrap;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__inline !== this.__inline) return true;
		if (prevNode.__equation !== this.__equation) draw(dom, this.__equation, !this.__inline);
		return false;
	}

	override isInline(): boolean {
		return this.__inline;
	}

	override decorate(): null {
		return null;
	}
}

/** Draws `tex` into an equation's DOM, or its "empty" prompt. */
function draw(wrap: HTMLElement, tex: string, display: boolean): void {
	const math = wrap.querySelector<HTMLElement>(".ne-eq-math");
	if (!math) return;
	const empty = tex.trim() === "";
	wrap.classList.toggle("is-empty", empty);
	if (empty) {
		delete math.dataset.tex;
		math.textContent = display ? "Add a TeX equation" : "New equation";
	} else renderMath(math, tex, display);
}

export function $createEquationNode(equation = "", inline = false): EquationNode {
	return new EquationNode(equation, inline);
}

export function $isEquationNode(node: LexicalNode | null | undefined): node is EquationNode {
	return node instanceof EquationNode;
}

/** `$$E = mc^2$$` inside a line becomes an inline equation. */
export const INLINE_EQUATION_TRANSFORMER: TextMatchTransformer = {
	dependencies: [EquationNode],
	export: (node) => ($isEquationNode(node) && node.isInline() ? `$$${node.getEquation()}$$` : null),
	importRegExp: /\$\$([^$\n]+?)\$\$/,
	regExp: /\$\$([^$\n]+?)\$\$$/,
	trigger: "$",
	replace: (textNode, match) => {
		textNode.replace($createEquationNode(match[1].trim(), true));
	},
	type: "text-match",
};

/**
 * A block equation: `$$` then a space at the start of a line while typing; in
 * pasted markdown, a `$$ … $$` block (on one line or several).
 */
export const BLOCK_EQUATION_TRANSFORMER: MultilineElementTransformer = {
	dependencies: [EquationNode],
	export: (node) =>
		$isEquationNode(node) && !node.isInline() ? `$$\n${node.getEquation()}\n$$` : null,
	// Only when the rest of the line has no `$$` (other than closing it), so a
	// line that starts with an inline equation stays a line.
	regExpStart: /^\$\$(?=[^$]*(?:\$\$\s*)?$)/,
	regExpEnd: { optional: true, regExp: /\$\$\s*$/ },
	replace: (parent, children, _start, _end, lines, isImport) => {
		if (!children && lines) {
			const equation = lines.join("\n").trim();
			parent.append($createEquationNode(equation, false));
			return;
		}
		if (isImport) return false;
		const node = $createEquationNode("", false);
		parent.replace(node);
		node.selectNext();
		pendingOpen = node.getKey();
	},
	type: "multiline-element",
};

/** An equation made by the `$$ ` shortcut, to open its editor once it's on the page. */
let pendingOpen: NodeKey | null = null;

/** Inserts an equation at the cursor (inline) or as a block, and opens its editor. */
export const INSERT_EQUATION_COMMAND = createCommand<{ inline: boolean }>(
	"INSERT_EQUATION_COMMAND",
);

/** Wires up inserting and editing equations. */
export function registerEquations(editor: LexicalEditor, host: HTMLElement): () => void {
	const pop = document.createElement("div");
	pop.className = "eq-pop";
	pop.hidden = true;
	const input = document.createElement("textarea");
	input.className = "eq-input";
	input.rows = 1;
	input.spellcheck = false;
	input.maxLength = MAX_EQUATION;
	input.placeholder = "E = mc^2";
	input.setAttribute("aria-label", "TeX equation");
	const foot = document.createElement("div");
	foot.className = "eq-foot";
	const hint = document.createElement("a");
	hint.className = "eq-hint";
	hint.href = "https://katex.org/docs/supported.html";
	hint.target = "_blank";
	hint.rel = "noopener";
	hint.textContent = "Supported functions";
	const done = document.createElement("button");
	done.type = "button";
	done.className = "eq-done";
	done.textContent = "Done ↵";
	foot.append(hint, done);
	pop.append(input, foot);
	document.body.append(pop);

	let open: { key: NodeKey; inline: boolean; original: string; wrap: HTMLElement } | null = null;

	const grow = () => {
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
	};
	const place = () => {
		if (!open) return;
		const rect = open.wrap.getBoundingClientRect();
		const width = Math.min(open.inline ? 380 : 520, innerWidth - 16);
		const left = open.inline
			? Math.min(Math.max(rect.left, 8), innerWidth - width - 8)
			: rect.left + (rect.width - width) / 2;
		pop.style.width = `${width}px`;
		pop.style.left = `${left + scrollX}px`;
		pop.style.top = `${rect.bottom + scrollY + 6}px`;
	};

	const openEditor = (key: NodeKey) => {
		if (open) close(true);
		const wrap = editor.getElementByKey(key);
		const node = editor.read(() => $getNodeByKey(key));
		if (!wrap || !$isEquationNode(node)) return;
		open = { key, inline: node.__inline, original: node.__equation, wrap };
		wrap.classList.add("is-editing");
		input.value = node.__equation;
		pop.hidden = false;
		place();
		grow();
		input.focus();
		input.select();
	};

	/** Closes the editor, saving what was typed (`commit`) or putting it back. */
	const close = (commit: boolean) => {
		if (!open) return;
		const { key, inline, original, wrap } = open;
		open = null;
		input.blur();
		pop.hidden = true;
		wrap.classList.remove("is-editing");
		const value = commit ? input.value.trim() : original;
		draw(wrap, value, !inline); // what the reader saw while typing may differ
		editor.update(
			() => {
				const node = $getNodeByKey(key);
				if (!$isEquationNode(node)) return;
				if (inline && value === "") {
					const prev = node.getPreviousSibling();
					node.remove();
					prev?.selectEnd();
					return;
				}
				if (node.__equation !== value) node.setEquation(value);
				if (inline) node.selectNext(0, 0);
				else if (commit) {
					// Done: keep writing on the line below.
					const next = node.getNextSibling() ?? node.insertAfter($createParagraphNode());
					next.selectStart();
				} else {
					const selection = $createNodeSelection();
					selection.add(key);
					$setSelection(selection);
				}
			},
			{
				onUpdate: () => {
					// Back to the page, keeping the selection just made (a block's ring).
					editor.getRootElement()?.focus({ preventScroll: true });
				},
			},
		);
	};

	// The textarea's keys stay out of the editor and the page's shortcuts.
	for (const type of ["keydown", "keypress", "keyup", "paste", "copy", "cut"])
		input.addEventListener(type, (event) => event.stopPropagation());
	input.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close(false);
		} else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			close(true);
		}
	});
	// Show the equation as it's typed (saved on Done).
	input.addEventListener("input", () => {
		grow();
		if (open) draw(open.wrap, input.value, !open.inline);
		place();
	});
	done.addEventListener("click", () => close(true));
	const onOutside = (event: PointerEvent) => {
		if (open && !pop.contains(event.target as Node)) close(true);
	};
	document.addEventListener("pointerdown", onOutside, true);
	const onResize = () => place();
	addEventListener("resize", onResize);

	// Clicking an equation opens it.
	const root = () => editor.getRootElement();
	const onClick = (event: MouseEvent) => {
		const wrap = (event.target as Element).closest<HTMLElement>(".ne-eq");
		if (!wrap || !root()?.contains(wrap)) return;
		event.preventDefault();
		const key = editor.read(() => {
			const node = $getNearestNodeFromDOMNode(wrap);
			return $isEquationNode(node) ? node.getKey() : null;
		});
		if (key) openEditor(key);
	};
	document.addEventListener("click", onClick);

	return mergeRegister(
		// A block equation can be selected (and deleted with Backspace) like an image.
		registerClickSelect(editor, host, ".ne-eq-block", $isEquationNode),
		editor.registerCommand(
			INSERT_EQUATION_COMMAND,
			({ inline }) => {
				const selection = $getSelection();
				let node: EquationNode;
				let edit = true;
				if (inline) {
					if (!$isRangeSelection(selection)) return false;
					// Selected text becomes the equation.
					const text = selection.getTextContent().replace(/\s+/g, " ").trim();
					node = $createEquationNode(text, true);
					selection.insertNodes([node]);
					edit = text === "";
				} else {
					node = $createEquationNode("", false);
					$insertBlocks([node], $selectedBlockKey());
				}
				const key = node.getKey();
				if (edit) pendingOpen = key;
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		),
		// Open an equation made by the command or the `$$ ` shortcut once it's drawn.
		editor.registerUpdateListener(() => {
			if (!pendingOpen) return;
			const key = pendingOpen;
			pendingOpen = null;
			requestAnimationFrame(() => openEditor(key));
		}),
		// Enter on a selected equation edits it.
		editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				const selection = $getSelection();
				if (!$isNodeSelection(selection)) return false;
				const nodes = selection.getNodes();
				if (nodes.length !== 1 || !$isEquationNode(nodes[0])) return false;
				event?.preventDefault();
				const key = nodes[0].getKey();
				queueMicrotask(() => openEditor(key));
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		),
		() => {
			document.removeEventListener("pointerdown", onOutside, true);
			document.removeEventListener("click", onClick);
			removeEventListener("resize", onResize);
			pop.remove();
		},
	);
}
