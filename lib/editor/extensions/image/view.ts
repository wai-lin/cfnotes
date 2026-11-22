import { dragWith, el, isolateInput } from "../../shared/dom.ts";

export const MIN_WIDTH = 80;
export const MAX_CAPTION = 500;

export interface ImageData {
	src: string;
	alt: string;
	width: number | null;
	caption: string;
}

export interface ImageHandlers {
	/** The corner drag ended at a new width. */
	onResize: (width: number) => void;
	/** The caption changed (while typing, debounced; and on blur). */
	onCaption: (caption: string) => void;
	/** Enter (`below`: keep writing after the image) or Escape (`image`: select it). */
	onLeave: (caption: string, to: "below" | "image") => void;
}

/**
 * An image block's DOM: the picture, a corner handle to resize it, and a
 * caption input. The input keeps its keys and clipboard away from the editor.
 */
export function createImageElement(data: ImageData, handlers: ImageHandlers): HTMLElement {
	const figure = el("figure", `ne-image${data.caption ? " has-caption" : ""}`);
	figure.contentEditable = "false";
	const frame = el("div", "ne-image-frame");
	const img = el("img");
	img.src = data.src;
	img.alt = data.caption || data.alt;
	img.draggable = false;
	if (data.width) img.style.width = `${data.width}px`;
	const handle = el("span", "ne-image-handle");
	handle.setAttribute("aria-hidden", "true");
	frame.append(img, handle);

	const caption = el("input", "ne-image-caption");
	caption.type = "text";
	caption.placeholder = "Add a caption…";
	caption.maxLength = MAX_CAPTION;
	caption.value = data.caption;
	caption.setAttribute("aria-label", "Image caption");
	figure.append(frame, caption);

	// Corner drag resizes; the width is saved once on release.
	handle.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startWidth = img.getBoundingClientRect().width;
		const max = figure.parentElement?.getBoundingClientRect().width ?? startWidth;
		let width = startWidth;
		dragWith(
			handle,
			event,
			(ev) => {
				width = Math.round(Math.min(Math.max(startWidth + ev.clientX - startX, MIN_WIDTH), max));
				img.style.width = `${width}px`;
			},
			() => {
				if (width !== startWidth) handlers.onResize(width);
			},
		);
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let leaving = false;
	const save = () => {
		clearTimeout(timer);
		if (!leaving) handlers.onCaption(caption.value.trim());
	};
	isolateInput(caption);
	caption.addEventListener("input", () => {
		figure.classList.toggle("has-caption", caption.value.trim() !== "");
		clearTimeout(timer);
		timer = setTimeout(save, 400);
	});
	caption.addEventListener("blur", save);
	caption.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== "Escape") return;
		event.preventDefault();
		clearTimeout(timer);
		// Blurring would save on its own; this save goes with the move instead.
		leaving = true;
		caption.blur();
		leaving = false;
		handlers.onLeave(caption.value.trim(), event.key === "Enter" ? "below" : "image");
	});
	return figure;
}

/** Brings an image block's DOM up to date with `next`. */
export function updateImageElement(dom: HTMLElement, prev: ImageData, next: ImageData): void {
	const img = dom.querySelector("img");
	if (img && prev.width !== next.width) img.style.width = next.width ? `${next.width}px` : "";
	if (img && prev.src !== next.src) img.src = next.src;
	if (prev.caption !== next.caption) {
		const caption = dom.querySelector<HTMLInputElement>(".ne-image-caption");
		// Undo/redo or a remote change; never clobber what's being typed.
		if (caption && document.activeElement !== caption) caption.value = next.caption;
		dom.classList.toggle("has-caption", next.caption !== "");
		if (img) img.alt = next.caption || next.alt;
	}
}

/** Copying out to other apps: a plain figure with an absolute image URL. */
export function exportImageElement(data: ImageData): HTMLElement {
	const figure = el("figure");
	const img = el("img");
	img.src = new URL(data.src, location.href).href;
	img.alt = data.caption || data.alt;
	if (data.width) img.width = data.width;
	figure.append(img);
	if (data.caption) figure.append(el("figcaption", "", data.caption));
	return figure;
}
