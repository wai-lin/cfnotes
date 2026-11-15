import { $isCodeNode } from "@lexical/code";
import { $isListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { icon } from "@modules/icons";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$isParagraphNode,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

import { $duplicateBlock, $removeBlock } from "./block-ops";
import {
	$duplicateBlocks,
	$removeBlocks,
	$selectBlocks,
	$selectedBlocks,
	$turnBlocksInto,
} from "./block-select";
import { $isCalloutNode } from "./callout-node";
import { $dropBeside, $isColumnsNode } from "./columns-node";
import { TURN_INTO_ITEMS } from "./slash-menu";

const HANDLE_W = 46;
/** How far past the editor's edges the pointer still counts as over it. */
const GUTTER = 24;
const HANDLE_H = 24;

/** Blocks whose text starts on their first line: the handle lines up with that line. */
const TEXT_BLOCK = /^(P|H[1-6]|UL|OL|BLOCKQUOTE)$/;

/**
 * Where the handle goes, from the top of the block: level with the first line
 * of text for plain text blocks, and at the top-left corner of anything with a
 * box of its own (code, callouts, tables, images, embeds, columns…).
 */
function topOffset(block: HTMLElement): number {
	// Short boxes (a divider) get it centred on them instead.
	if (!TEXT_BLOCK.test(block.tagName)) return Math.min(4, (block.offsetHeight - HANDLE_H) / 2);
	const first = block.tagName === "UL" || block.tagName === "OL" ? block.firstElementChild : block;
	const cs = getComputedStyle(first instanceof HTMLElement ? first : block);
	let line = Number.parseFloat(cs.lineHeight);
	if (!line || Number.isNaN(line)) line = (Number.parseFloat(cs.fontSize) || 16) * 1.5;
	const pad = Number.parseFloat(getComputedStyle(block).paddingTop) || 0;
	return Math.max(0, pad + (line - HANDLE_H) / 2);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
	const node = document.createElement(tag);
	node.className = className;
	if (text) node.textContent = text;
	return node;
}

/**
 * Notion-style block handles: hovering a top-level block shows `+` (insert below)
 * and a ⋮⋮ grip beside it. Dragging the grip moves the block; clicking it opens
 * a menu with Turn into / Duplicate / Delete.
 */
export function registerBlockHandles(editor: LexicalEditor, host: HTMLElement): () => void {
	const handle = el("div", "blk-handle");
	handle.hidden = true;
	const plus = el("button", "blk-btn blk-plus");
	plus.type = "button";
	plus.innerHTML = icon("plus", 17);
	plus.title = "Add a block below";
	plus.setAttribute("aria-label", "Add a block below");
	const grip = el("button", "blk-btn blk-grip");
	grip.type = "button";
	grip.innerHTML = icon("gripVertical", 17);
	grip.title = "Drag to move, click for actions";
	grip.setAttribute("aria-label", "Block actions");
	grip.draggable = true;
	handle.append(plus, grip);
	host.append(handle);

	const dropline = el("div", "blk-dropline");
	dropline.hidden = true;
	host.append(dropline);

	const menu = el("div", "blk-menu");
	menu.hidden = true;
	menu.setAttribute("role", "menu");
	menu.addEventListener("mousedown", (event) => event.preventDefault());
	document.body.append(menu);

	let blockKey: NodeKey | null = null;
	let blockEl: HTMLElement | null = null;
	let dropAt: { key: NodeKey; before: boolean; side: "left" | "right" | null } | null = null;

	const hideHandle = () => {
		if (!menu.hidden || dragKeys.length > 0) return;
		handle.hidden = true;
		blockKey = null;
		blockEl = null;
	};

	const closeMenu = () => {
		menu.hidden = true;
	};

	/**
	 * The block under the pointer: a top-level block whose box spans `y`, or,
	 * in a row of columns, the block of the column nearest `x` that spans `y`.
	 */
	const blockAt = (x: number, y: number): HTMLElement | null => {
		const root = editor.getRootElement();
		if (!root) return null;
		const spanning = (parent: Element) => {
			for (const child of parent.children) {
				const rect = child.getBoundingClientRect();
				if (y >= rect.top && y <= rect.bottom) return child as HTMLElement;
			}
			return null;
		};
		const block = spanning(root);
		if (!block?.classList.contains("ne-columns")) return block;
		let nearest: Element | null = null;
		let distance = Infinity;
		for (const column of block.children) {
			const rect = column.getBoundingClientRect();
			const d = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
			if (d < distance) {
				distance = d;
				nearest = column;
			}
		}
		return nearest ? spanning(nearest) : null;
	};

	const show = (block: HTMLElement) => {
		const key = editor.read(() => {
			const node = $getNearestNodeFromDOMNode(block);
			return node?.getTopLevelElement()?.getKey() ?? node?.getKey() ?? null;
		});
		if (!key) return hideHandle();
		blockKey = key;
		blockEl = block;
		const hostRect = host.getBoundingClientRect();
		const rect = block.getBoundingClientRect();
		handle.style.top = `${rect.top - hostRect.top + topOffset(block)}px`;
		handle.style.left = `${rect.left - hostRect.left - HANDLE_W}px`;
		handle.hidden = false;
	};

	/**
	 * Hover tracking on the whole document, not just the editor: the handle sits
	 * in the margin left of the editor's box, so the pointer leaves the editor on
	 * its way to the grip. It counts as "over the editor" anywhere in that margin.
	 */
	let frame = 0;
	let last: MouseEvent | null = null;
	const track = () => {
		frame = 0;
		const event = last;
		if (!event || dragKeys.length > 0 || !menu.hidden) return;
		// A pressed button means a drag may be starting: moving the handle now
		// would pull the grip out from under the pointer before dragstart fires.
		if (event.buttons & 1) return;
		if (handle.contains(event.target as Node)) return;
		const box = host.getBoundingClientRect();
		const { clientX: x, clientY: y } = event;
		const near =
			x >= box.left - HANDLE_W - GUTTER &&
			x <= box.right + GUTTER &&
			y >= box.top - 4 &&
			y <= box.bottom + 4;
		if (!near) return hideHandle();
		// In the gaps between blocks, keep the handle where it is.
		const block = blockAt(x, y);
		if (block) show(block);
	};
	const onMove = (event: MouseEvent) => {
		last = event;
		frame ||= requestAnimationFrame(track);
	};
	const onLeave = () => hideHandle();
	document.addEventListener("mousemove", onMove, { passive: true });
	document.documentElement.addEventListener("mouseleave", onLeave);

	// Keep the editor's focus when pressing +. Not on the grip: cancelling
	// mousedown there would stop the browser from ever starting its drag.
	plus.addEventListener("mousedown", (event) => event.preventDefault());

	// ---- + : a fresh "/" line below (or on) this block ----
	plus.addEventListener("click", () => {
		const key = blockKey;
		if (!key) return;
		closeMenu();
		editor.update(() => {
			const node = $getNodeByKey(key);
			if (!node) return;
			if ($isParagraphNode(node) && node.getTextContentSize() === 0) {
				node.select().insertText("/");
				return;
			}
			const paragraph = $createParagraphNode();
			node.insertAfter(paragraph);
			paragraph.select().insertText("/");
		});
		editor.focus();
	});

	/**
	 * The blocks an action applies to: the whole block selection when the
	 * handle's block is part of it, otherwise just that block. Read when the
	 * grip is pressed, before anything can change the selection.
	 */
	let group: NodeKey[] = [];
	grip.addEventListener("pointerdown", () => {
		const key = blockKey;
		const selected = editor.read(() => $selectedBlocks().map((b) => b.getKey()));
		group = key && selected.includes(key) ? selected : key ? [key] : [];
	});
	const groupNodes = () => group.flatMap((key) => $getNodeByKey(key) ?? []);

	// ---- drag to move ----
	let dragKeys: NodeKey[] = [];
	grip.addEventListener("dragstart", (event) => {
		if (!blockKey || !blockEl) return;
		dragKeys = group.length > 0 ? group : [blockKey];
		closeMenu();
		event.dataTransfer?.setData("text/plain", "");
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setDragImage(blockEl, 20, 10);
		}
		for (const key of dragKeys) editor.getElementByKey(key)?.classList.add("blk-source");
	});

	const onDragOver = (event: DragEvent) => {
		if (dragKeys.length === 0) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		const block = blockAt(event.clientX, event.clientY);
		if (!block) return;
		const key = editor.read(
			() => $getNearestNodeFromDOMNode(block)?.getTopLevelElement()?.getKey() ?? null,
		);
		if (!key || dragKeys.includes(key)) {
			dropAt = null;
			dropline.hidden = true;
			return;
		}
		const rect = block.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		// Past the block's edges makes a column beside it (Notion's drag-to-side):
		// its right part, or left of the grip, so a drag straight down from the grip
		// (which drifts a little either way) still just moves the block.
		const x = event.clientX;
		const side =
			x >= rect.right - Math.min(120, rect.width * 0.3)
				? "right"
				: x <= rect.left - 32
					? "left"
					: null;
		const before = event.clientY < rect.top + rect.height / 2;
		dropAt = { key, before, side };
		dropline.classList.toggle("is-side", side !== null);
		if (side) {
			dropline.style.top = `${rect.top - hostRect.top}px`;
			dropline.style.left = `${(side === "left" ? rect.left - 6 : rect.right + 4) - hostRect.left}px`;
			dropline.style.width = "";
			dropline.style.height = `${rect.height}px`;
		} else {
			dropline.style.top = `${(before ? rect.top : rect.bottom) - hostRect.top - 1}px`;
			dropline.style.left = `${rect.left - hostRect.left}px`;
			dropline.style.width = `${rect.width}px`;
			dropline.style.height = "";
		}
		dropline.hidden = false;
	};

	const onDrop = (event: DragEvent) => {
		if (dragKeys.length === 0) return;
		event.preventDefault();
		const moving = dragKeys;
		const to = dropAt;
		endDrag();
		if (!to) return;
		editor.update(() => {
			const target = $getNodeByKey(to.key);
			const nodes = moving.flatMap((key) => $getNodeByKey(key) ?? []);
			if (!target || nodes.length === 0) return;
			// A whole row of columns can't go inside another column.
			if (to.side && !nodes.some($isColumnsNode)) return $dropBeside(target, nodes, to.side);
			// Insert in document order, each after the previous one.
			let anchor = target;
			nodes.forEach((node, i) => {
				if (i === 0 && to.before) target.insertBefore(node);
				else anchor.insertAfter(node);
				anchor = node;
			});
			if (moving.length > 1) $selectBlocks(moving);
		});
	};

	const endDrag = () => {
		dragKeys = [];
		dropAt = null;
		dropline.hidden = true;
		for (const source of host.querySelectorAll(".blk-source"))
			source.classList.remove("blk-source");
		hideHandle();
	};

	// On the document: a drop beside a block lands in the page margin, outside the editor.
	document.addEventListener("dragover", onDragOver);
	document.addEventListener("drop", onDrop);
	grip.addEventListener("dragend", endDrag);

	// ---- grip click: block menu ----
	const menuItem = (label: string, danger: boolean, run: () => void) => {
		const button = el("button", `blk-menu-item${danger ? " is-danger" : ""}`, label);
		button.type = "button";
		button.setAttribute("role", "menuitem");
		button.addEventListener("click", () => {
			closeMenu();
			run();
		});
		return button;
	};

	const openMenu = () => {
		if (group.length === 0) return;
		const keys = group;
		const convertible = editor.read(() =>
			keys.some((key) => {
				const node = $getNodeByKey(key);
				return (
					$isParagraphNode(node) ||
					$isHeadingNode(node) ||
					$isQuoteNode(node) ||
					$isCodeNode(node) ||
					$isCalloutNode(node) ||
					$isListNode(node)
				);
			}),
		);
		const many = keys.length > 1;
		menu.replaceChildren(
			...(many ? [el("div", "blk-menu-head", `${keys.length} blocks`)] : []),
			menuItem("Duplicate", false, () => duplicate()),
			menuItem("Delete", true, () => remove()),
		);
		if (convertible) {
			menu.append(el("div", "blk-menu-head", "Turn into"));
			for (const item of TURN_INTO_ITEMS) {
				menu.append(
					menuItem(item.label, false, () => {
						editor.update(() => {
							const nodes = groupNodes();
							const node = nodes[0];
							if (!node) return;
							if (nodes.length > 1) return $turnBlocksInto(editor, nodes, item.apply);
							// A list converts item by item, so cover all of it.
							if ($isListNode(node)) node.select(0, node.getChildrenSize());
							else node.selectStart();
							item.apply(editor);
						});
						editor.focus();
					}),
				);
			}
		}
		menu.hidden = false;
		const rect = grip.getBoundingClientRect();
		const top = rect.bottom + 4;
		menu.style.top = `${top + menu.offsetHeight < innerHeight ? top : Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
	};

	grip.addEventListener("click", () => {
		if (menu.hidden) openMenu();
		else closeMenu();
	});

	const duplicate = () => {
		editor.update(() => {
			const nodes = groupNodes();
			if (nodes.length > 1) $duplicateBlocks(editor, nodes);
			else if (nodes[0]) $duplicateBlock(editor, nodes[0].getKey());
		});
		editor.focus();
	};

	const remove = () => {
		editor.update(() => {
			const nodes = groupNodes();
			if (nodes.length > 1) $removeBlocks(nodes);
			else if (nodes[0]) $removeBlock(nodes[0].getKey());
		});
		hideHandle();
	};

	const onOutside = (event: PointerEvent) => {
		if (menu.hidden) return;
		const node = event.target as Node;
		if (!menu.contains(node) && !grip.contains(node)) closeMenu();
	};
	document.addEventListener("pointerdown", onOutside, true);

	// Typing: get the chrome out of the way.
	const onKeyDown = () => {
		closeMenu();
		hideHandle();
	};
	host.addEventListener("keydown", onKeyDown);

	return () => {
		document.removeEventListener("mousemove", onMove);
		document.documentElement.removeEventListener("mouseleave", onLeave);
		cancelAnimationFrame(frame);
		document.removeEventListener("dragover", onDragOver);
		document.removeEventListener("drop", onDrop);
		host.removeEventListener("keydown", onKeyDown);
		document.removeEventListener("pointerdown", onOutside, true);
		handle.remove();
		dropline.remove();
		menu.remove();
	};
}
