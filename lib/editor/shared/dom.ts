/** DOM helpers for the editor's views. Nothing here knows about Lexical. */
import { icon, type IconName } from "./icons.ts";

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text) node.textContent = text;
	return node;
}

/** A `type="button"` button with an accessible name and, optionally, an icon. */
export function iconButton(
	className: string,
	label: string,
	glyph?: IconName,
	size = 14,
): HTMLButtonElement {
	const button = el("button", className);
	button.type = "button";
	button.setAttribute("aria-label", label);
	if (glyph) button.innerHTML = icon(glyph, size);
	return button;
}

/** Adds a listener; returns the function that removes it. */
export function listen<T extends EventTarget>(
	target: T,
	type: string,
	handler: (event: never) => void,
	options?: boolean | AddEventListenerOptions,
): () => void {
	const listener = handler as EventListener;
	target.addEventListener(type, listener, options);
	return () => target.removeEventListener(type, listener, options);
}

/** Pressing on `element` doesn't take focus (or the selection) from the editor. */
export function keepFocus(element: HTMLElement): void {
	element.addEventListener("mousedown", (event) => event.preventDefault());
}

const INPUT_EVENTS = [
	"keydown",
	"keypress",
	"keyup",
	"beforeinput",
	"input",
	"paste",
	"copy",
	"cut",
];

/** Keeps an input's keys and clipboard away from the editor and the page's shortcuts. */
export function isolateInput(input: HTMLElement, types: string[] = INPUT_EVENTS): void {
	for (const type of types) input.addEventListener(type, (event) => event.stopPropagation());
}

/**
 * Places a `position: fixed` popup `gap` px under `rect`, or over it when it
 * would come within `bottom` px of the window's bottom; kept on screen sideways.
 */
export function placeFixed(popup: HTMLElement, rect: DOMRect, gap = 6, bottom = 0): void {
	const top = rect.bottom + gap;
	const fitsBelow = top + popup.offsetHeight < innerHeight - bottom;
	popup.style.top = `${fitsBelow ? top : Math.max(8, rect.top - popup.offsetHeight - gap)}px`;
	popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
}

/** The caret's (or the selection's) box on screen, if there is one. */
export function caretRect(): DOMRect | null {
	const selection = getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	return selection.getRangeAt(0).getBoundingClientRect();
}

/**
 * Follow the pointer only when it really moves. When arrow keys scroll a
 * menu, items slide under a resting pointer and the browser fires hover
 * events for them; reacting to those would steal the keyboard highlight.
 */
export function onPointerHover(
	list: HTMLElement,
	selector: string,
	onIndex: (index: number) => void,
): void {
	let last = "";
	list.addEventListener("pointermove", (event) => {
		const at = `${event.screenX},${event.screenY}`;
		if (at === last) return;
		last = at;
		const item = (event.target as Element).closest<HTMLElement>(selector);
		const index = Number(item?.dataset.index ?? -1);
		if (index >= 0) onIndex(index);
	});
}

/** Moves `is-active` (and `aria-selected`) to item `active` and scrolls it into view. */
export function highlightItems(list: HTMLElement, selector: string, active: number): void {
	list.querySelectorAll<HTMLElement>(selector).forEach((item, index) => {
		item.classList.toggle("is-active", index === active);
		item.setAttribute("aria-selected", String(index === active));
	});
	list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
}

/** A press outside every one of `inside` (checked in the capture phase). */
export function onPointerOutside(
	inside: () => (Node | null | undefined)[],
	handler: (event: PointerEvent) => void,
): () => void {
	return listen(
		document,
		"pointerdown",
		(event: PointerEvent) => {
			const target = event.target as Node;
			if (!inside().some((node) => node?.contains(target))) handler(event);
		},
		true,
	);
}

/** Drags with pointer capture on `handle`: `move` while dragging, `end` on release. */
export function dragWith(
	handle: HTMLElement,
	event: PointerEvent,
	move: (event: PointerEvent) => void,
	end: () => void,
): void {
	handle.setPointerCapture(event.pointerId);
	const up = () => {
		handle.removeEventListener("pointermove", move);
		handle.removeEventListener("pointerup", up);
		end();
	};
	handle.addEventListener("pointermove", move);
	handle.addEventListener("pointerup", up);
}
