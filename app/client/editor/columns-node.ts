import { mergeRegister } from "@lexical/utils";
import {
	$applyNodeReplacement,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isRootNode,
	ElementNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedElementNode,
	type Spread,
} from "lexical";

export type SerializedColumnsNode = Spread<{ widths: number[] }, SerializedElementNode>;

const MIN_SHARE = 0.12;

const equalWidths = (count: number) => Array.from({ length: count }, () => 1 / count);

function gridTemplate(widths: number[]): string {
	return widths.map((w) => `minmax(0, ${w.toFixed(4)}fr)`).join(" ");
}

/**
 * Side-by-side columns, like Notion's. Holds two or more `ColumnNode`s;
 * `widths` are their shares of the row (they add up to 1).
 */
export class ColumnsNode extends ElementNode {
	__widths: number[];

	static override getType(): string {
		return "columns";
	}

	static override clone(node: ColumnsNode): ColumnsNode {
		return new ColumnsNode([...node.__widths], node.__key);
	}

	static override importJSON(json: SerializedColumnsNode): ColumnsNode {
		return $createColumnsNode(json.widths).updateFromJSON(json);
	}

	constructor(widths: number[] = [], key?: NodeKey) {
		super(key);
		this.__widths = widths;
	}

	getWidths(): number[] {
		return this.getLatest().__widths;
	}

	setWidths(widths: number[]): this {
		const writable = this.getWritable();
		writable.__widths = widths;
		return writable;
	}

	override exportJSON(): SerializedColumnsNode {
		return { ...super.exportJSON(), widths: this.getWidths() };
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-columns";
		dom.style.gridTemplateColumns = gridTemplate(this.__widths);
		return dom;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		if (prevNode.__widths.join() !== this.__widths.join())
			dom.style.gridTemplateColumns = gridTemplate(this.__widths);
		return false;
	}

	override canBeEmpty(): boolean {
		return false;
	}

	override isShadowRoot(): boolean {
		return false;
	}
}

/** One column: a little document of its own (like a table cell), so typing stays inside it. */
export class ColumnNode extends ElementNode {
	static override getType(): string {
		return "column";
	}

	static override clone(node: ColumnNode): ColumnNode {
		return new ColumnNode(node.__key);
	}

	static override importJSON(json: SerializedElementNode): ColumnNode {
		return $createColumnNode().updateFromJSON(json);
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-column";
		return dom;
	}

	override updateDOM(): boolean {
		return false;
	}

	override isShadowRoot(): boolean {
		return true;
	}

	override canBeEmpty(): boolean {
		return false;
	}
}

export function $createColumnsNode(widths: number[] = []): ColumnsNode {
	return $applyNodeReplacement(new ColumnsNode(widths));
}

export function $createColumnNode(): ColumnNode {
	return $applyNodeReplacement(new ColumnNode());
}

export function $isColumnsNode(node: LexicalNode | null | undefined): node is ColumnsNode {
	return node instanceof ColumnsNode;
}

export function $isColumnNode(node: LexicalNode | null | undefined): node is ColumnNode {
	return node instanceof ColumnNode;
}

/** A row of `count` empty columns after the current block (replacing it if empty). */
export function $insertColumns(count: number): void {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	let block: LexicalNode | null = selection.anchor.getNode();
	// Columns don't nest: from inside one, add the row below the whole set.
	while (block && !$isRootNode(block.getParent())) block = block.getParent();
	if (!block) return;
	const columns = $createColumnsNode(equalWidths(count));
	for (let i = 0; i < count; i++)
		columns.append($createColumnNode().append($createParagraphNode()));
	if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.replace(columns);
	else block.insertAfter(columns);
	if (!columns.getNextSibling()) columns.insertAfter($createParagraphNode());
	columns.getFirstDescendant()?.selectStart();
}

/**
 * Drops `nodes` beside `target` as a new column (Notion's drag-to-side). A
 * target inside columns gets a new column next to its own; any other block
 * becomes a two-column row with the dropped blocks. Call inside `editor.update`.
 */
export function $dropBeside(
	target: LexicalNode,
	nodes: LexicalNode[],
	side: "left" | "right",
): void {
	const column = $createColumnNode();
	column.append(...nodes);
	const own = target.getParent();
	if ($isColumnNode(own)) {
		if (side === "left") own.insertBefore(column);
		else own.insertAfter(column);
		// Even shares for all; dragging the gaps fine-tunes them.
		const row = own.getParent();
		if ($isColumnsNode(row)) {
			row.setWidths(equalWidths(row.getChildrenSize()));
			if (!row.getNextSibling()) row.insertAfter($createParagraphNode());
		}
		return;
	}
	const columns = $createColumnsNode(equalWidths(2));
	target.insertBefore(columns);
	const home = $createColumnNode();
	home.append(target);
	columns.append(...(side === "left" ? [column, home] : [home, column]));
	// Somewhere below the row to click into or drop onto.
	if (!columns.getNextSibling()) columns.insertAfter($createParagraphNode());
}

/**
 * Keeps the structure valid whatever edits do: columns only in rows at the top
 * level, rows of two or more, no empty columns, one width per column.
 */
function registerRepairs(editor: LexicalEditor): () => void {
	return mergeRegister(
		editor.registerNodeTransform(ColumnNode, (column) => {
			const parent = column.getParent();
			if (!$isColumnsNode(parent)) {
				// A stray column: its blocks take its place.
				for (const child of column.getChildren()) column.insertBefore(child);
				column.remove();
			} else if (column.isEmpty()) column.remove();
		}),
		editor.registerNodeTransform(ColumnsNode, (row) => {
			const unwrap = () => {
				for (const child of row.getChildren())
					for (const block of $isColumnNode(child) ? child.getChildren() : [child])
						row.insertBefore(block);
				row.remove();
			};
			if (!$isRootNode(row.getParent())) return unwrap();
			// Anything that isn't a column moves out below the row.
			for (const child of row.getChildren().reverse())
				if (!$isColumnNode(child)) row.insertAfter(child);
			const count = row.getChildrenSize();
			if (count < 2) return unwrap();
			const widths = row.getWidths();
			const total = widths.reduce((a, b) => a + b, 0);
			if (widths.length !== count || Math.abs(total - 1) > 0.001) row.setWidths(equalWidths(count));
		}),
	);
}

/**
 * Columns behaviour: repairs, and resizing by dragging the gap between two
 * columns (the widths are saved when the drag ends).
 */
export function registerColumns(editor: LexicalEditor, host: HTMLElement): () => void {
	const grip = document.createElement("div");
	grip.className = "col-resizer";
	grip.hidden = true;
	host.append(grip);

	/** The gap under the pointer: the row's key, the gap index and the two columns' boxes. */
	let hover: { row: HTMLElement; index: number } | null = null;
	let dragging = false;

	const onMove = (event: MouseEvent) => {
		if (dragging || event.buttons || event.target === grip) return;
		const row = (event.target as Element).closest<HTMLElement>(".ne-columns");
		hover = null;
		if (row && host.contains(row)) {
			const cols = [...row.children].filter((c) => c.classList.contains("ne-column"));
			for (let i = 0; i < cols.length - 1; i++) {
				const a = (cols[i] as HTMLElement).getBoundingClientRect();
				const b = (cols[i + 1] as HTMLElement).getBoundingClientRect();
				const mid = (a.right + b.left) / 2;
				// The middle third of the gap, so the next column's block handle stays usable.
				if (Math.abs(event.clientX - mid) <= Math.max(4, (b.left - a.right) / 6)) {
					hover = { row, index: i };
					const hostRect = host.getBoundingClientRect();
					const rowRect = row.getBoundingClientRect();
					Object.assign(grip.style, {
						left: `${mid - hostRect.left - 2}px`,
						top: `${rowRect.top - hostRect.top}px`,
						height: `${rowRect.height}px`,
					});
					break;
				}
			}
		}
		grip.hidden = hover === null;
	};

	const onDown = (event: PointerEvent) => {
		if (!hover) return;
		event.preventDefault();
		dragging = true;
		grip.setPointerCapture(event.pointerId);
		const { row, index } = hover;
		const key = editor.read(() => $getNearestNodeFromDOMNode(row)?.getKey() ?? null);
		const widths = editor.read(() => {
			const node = key ? $getNodeByKey(key) : null;
			return $isColumnsNode(node) ? [...node.getWidths()] : [];
		});
		const cols = [...row.children].filter((c) => c.classList.contains("ne-column"));
		const a = (cols[index] as HTMLElement).getBoundingClientRect();
		const b = (cols[index + 1] as HTMLElement).getBoundingClientRect();
		const pair = (widths[index] ?? 0) + (widths[index + 1] ?? 0);
		let next = widths;
		const move = (ev: PointerEvent) => {
			// Where the pointer sits between the pair's outer edges sets the split.
			const share = Math.min(
				Math.max((ev.clientX - a.left) / (b.right - a.left), MIN_SHARE),
				1 - MIN_SHARE,
			);
			next = [...widths];
			next[index] = pair * share;
			next[index + 1] = pair * (1 - share);
			row.style.gridTemplateColumns = gridTemplate(next);
			grip.style.left = `${ev.clientX - host.getBoundingClientRect().left - 2}px`;
		};
		const up = () => {
			dragging = false;
			grip.removeEventListener("pointermove", move);
			grip.removeEventListener("pointerup", up);
			if (key && next !== widths)
				editor.update(() => {
					const node = $getNodeByKey(key);
					if ($isColumnsNode(node)) node.setWidths(next);
				});
		};
		grip.addEventListener("pointermove", move);
		grip.addEventListener("pointerup", up);
	};

	host.addEventListener("mousemove", onMove);
	grip.addEventListener("pointerdown", onDown);

	return mergeRegister(registerRepairs(editor), () => {
		host.removeEventListener("mousemove", onMove);
		grip.remove();
	});
}
