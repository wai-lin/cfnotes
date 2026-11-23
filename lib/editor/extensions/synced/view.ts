import { el, listen } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";

/**
 * The bar above a synced block the pointer is over or the caret is in: what
 * it is, "Copy and sync" and "Unsync".
 */
export function createSyncedBar(
	host: HTMLElement,
	options: {
		find: (target: Element) => HTMLElement | null;
		/** Copies the block; `false` when the browser wouldn't. */
		onCopy: (block: HTMLElement) => boolean;
		onUnsync: (block: HTMLElement) => void;
	},
): { update: () => void; destroy: () => void } {
	const bar = el("div", "ne-synced-bar");
	bar.contentEditable = "false";
	bar.hidden = true;
	const label = el("span", "ne-synced-label");
	label.innerHTML = icon("arrowsExchange", 14);
	label.append(el("span", "", "Synced block"));
	const button = (text: string, name: Parameters<typeof icon>[0], title: string) => {
		const b = el("button", "ne-synced-btn");
		b.type = "button";
		b.title = title;
		b.innerHTML = icon(name, 14);
		b.append(el("span", "", text));
		// Keep the caret where it is.
		b.addEventListener("mousedown", (e) => e.preventDefault());
		return b;
	};
	const copy = button("Copy and sync", "copy", "Copy, then paste into any page for a synced copy");
	const unsync = button(
		"Unsync",
		"unlink",
		"Make this copy ordinary blocks; the others stay synced",
	);
	bar.append(label, copy, unsync);
	host.append(bar);

	let hovered: HTMLElement | null = null;
	let current: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const place = (block: HTMLElement | null) => {
		for (const active of host.querySelectorAll(".ne-synced.is-active"))
			if (active !== block) active.classList.remove("is-active");
		current = block;
		if (!block) {
			bar.hidden = true;
			return;
		}
		block.classList.add("is-active");
		const box = block.getBoundingClientRect();
		const origin = host.getBoundingClientRect();
		bar.hidden = false;
		bar.style.top = `${box.top - origin.top - bar.offsetHeight - 2}px`;
		bar.style.left = `${box.left - origin.left}px`;
	};

	/** The block the caret is in, if the editor has focus. */
	const caretBlock = () => {
		const selection = getSelection();
		const node = selection?.anchorNode;
		const element = node instanceof Element ? node : (node?.parentElement ?? null);
		return element && host.contains(element) ? options.find(element) : null;
	};
	const update = () => place(hovered ?? caretBlock());

	copy.addEventListener("click", () => {
		if (!current) return;
		const ok = options.onCopy(current);
		const text = copy.querySelector("span")!;
		text.textContent = ok ? "Copied: paste it into any page" : "Press ⌘C to copy";
		clearTimeout(timer);
		timer = setTimeout(() => (text.textContent = "Copy and sync"), 2500);
	});
	unsync.addEventListener("click", () => {
		if (current) options.onUnsync(current);
		hovered = null;
		place(null);
	});

	const offOver = listen(host, "pointerover", (e: PointerEvent) => {
		const target = e.target as Element;
		if (bar.contains(target)) return;
		hovered = options.find(target);
		update();
	});
	const offLeave = listen(host, "pointerleave", () => {
		hovered = null;
		update();
	});
	const offSelect = listen(document, "selectionchange", update);

	return {
		update,
		destroy() {
			clearTimeout(timer);
			offOver();
			offLeave();
			offSelect();
			bar.remove();
		},
	};
}
