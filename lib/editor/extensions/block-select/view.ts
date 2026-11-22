import { el } from "../../shared/dom.ts";

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** The box drawn while dragging from the margin (null hides it). */
export function createMarqueeView(): { render(box: Box | null): void; destroy(): void } {
	const marquee = el("div", "blk-marquee");
	marquee.hidden = true;
	document.body.append(marquee);
	return {
		render(box) {
			marquee.hidden = !box;
			if (!box) return;
			Object.assign(marquee.style, {
				left: `${box.left}px`,
				top: `${box.top}px`,
				width: `${box.right - box.left}px`,
				height: `${box.bottom - box.top}px`,
			});
		},
		destroy: () => marquee.remove(),
	};
}

/** The editor's blocks (its root's children) whose boxes the marquee crosses. */
export function blocksIn(root: HTMLElement, box: Box): HTMLElement[] {
	const hits: HTMLElement[] = [];
	for (const child of root.children) {
		if (child.matches("[data-lexical-decorator-boundary], [data-lexical-cursor]")) continue;
		const rect = child.getBoundingClientRect();
		if (
			rect.bottom >= box.top &&
			rect.top <= box.bottom &&
			rect.right >= box.left &&
			rect.left <= box.right
		)
			hits.push(child as HTMLElement);
	}
	return hits;
}
