import type { NodeKey } from "lexical";

import { el, keepFocus } from "../../shared/dom";
import { icon } from "../../shared/icons";
import type { BlockHandlesState } from "./state";

export const HANDLE_W = 46;
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

/**
 * The block under the pointer: a top-level block whose box spans `y`, or,
 * in a row of columns, the block of the column nearest `x` that spans `y`.
 */
export function blockAt(root: HTMLElement, x: number, y: number): HTMLElement | null {
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
}

export interface BlockHandlesView {
	handle: HTMLElement;
	grip: HTMLButtonElement;
	menu: HTMLElement;
	render(state: BlockHandlesState, prev?: BlockHandlesState): void;
	destroy(): void;
}

/**
 * The `+` and ⋮⋮ grip beside a block, the drop line while dragging, and the
 * grip's menu (Duplicate / Delete / Turn into…).
 */
export function createBlockHandlesView(options: {
	host: HTMLElement;
	blockElement: (key: NodeKey) => HTMLElement | null;
	turnInto: { label: string }[];
	onPlus: () => void;
	onGripPress: () => void;
	onGripClick: () => void;
	onDragStart: (event: DragEvent) => void;
	onDragEnd: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onTurnInto: (index: number) => void;
}): BlockHandlesView {
	const { host } = options;
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
	keepFocus(menu);
	document.body.append(menu);

	// Keep the editor's focus when pressing +. Not on the grip: cancelling
	// mousedown there would stop the browser from ever starting its drag.
	keepFocus(plus);
	plus.addEventListener("click", options.onPlus);
	grip.addEventListener("pointerdown", options.onGripPress);
	grip.addEventListener("click", options.onGripClick);
	grip.addEventListener("dragstart", options.onDragStart);
	grip.addEventListener("dragend", options.onDragEnd);

	const menuItem = (label: string, danger: boolean, run: () => void) => {
		const button = el("button", `blk-menu-item${danger ? " is-danger" : ""}`, label);
		button.type = "button";
		button.setAttribute("role", "menuitem");
		button.addEventListener("click", run);
		return button;
	};

	const fillMenu = (count: number, convertible: boolean) => {
		menu.replaceChildren(
			...(count > 1 ? [el("div", "blk-menu-head", `${count} blocks`)] : []),
			menuItem("Duplicate", false, options.onDuplicate),
			menuItem("Delete", true, options.onDelete),
		);
		if (!convertible) return;
		menu.append(el("div", "blk-menu-head", "Turn into"));
		options.turnInto.forEach((item, index) =>
			menu.append(menuItem(item.label, false, () => options.onTurnInto(index))),
		);
	};

	const placeHandle = (block: HTMLElement) => {
		const hostRect = host.getBoundingClientRect();
		const rect = block.getBoundingClientRect();
		handle.style.top = `${rect.top - hostRect.top + topOffset(block)}px`;
		handle.style.left = `${rect.left - hostRect.left - HANDLE_W}px`;
	};

	const placeDropline = (state: BlockHandlesState) => {
		const target = state.drop ? options.blockElement(state.drop.key) : null;
		dropline.hidden = !target;
		if (!target || !state.drop) return;
		const { before, side } = state.drop;
		const rect = target.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
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
	};

	return {
		handle,
		grip,
		menu,
		render(state, prev) {
			handle.hidden = !state.block;
			if (state.block && state.block !== prev?.block) placeHandle(state.block.element);
			if (state.drop !== prev?.drop) placeDropline(state);
			if (state.dragging !== prev?.dragging) {
				for (const source of host.querySelectorAll(".blk-source"))
					source.classList.remove("blk-source");
				for (const key of state.dragging) options.blockElement(key)?.classList.add("blk-source");
			}
			if (state.menu !== prev?.menu) {
				menu.hidden = !state.menu;
				if (state.menu) {
					fillMenu(state.group.length, state.menu.convertible);
					const rect = grip.getBoundingClientRect();
					const top = rect.bottom + 4;
					menu.style.top = `${top + menu.offsetHeight < innerHeight ? top : Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
					menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
				}
			}
		},
		destroy() {
			handle.remove();
			dropline.remove();
			menu.remove();
		},
	};
}
