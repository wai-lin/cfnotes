import { dragWith, el } from "../../shared/dom";
import { gridTemplate, splitAt } from "./layout";

/** A row of columns and the gap under the pointer (between `index` and `index + 1`). */
export interface Gap {
	row: HTMLElement;
	index: number;
}

const columnsOf = (row: HTMLElement) =>
	[...row.children].filter((c) => c.classList.contains("ne-column")) as HTMLElement[];

/**
 * The resize grip between two columns: it shows over the gap under the
 * pointer, and dragging it resizes the pair live. `widthsOf` reads a row's
 * saved widths; `onResize` saves the new ones when the drag ends.
 */
export function createColumnResizer(options: {
	host: HTMLElement;
	widthsOf: (row: HTMLElement) => number[];
	onResize: (row: HTMLElement, widths: number[]) => void;
}): { grip: HTMLElement; hover(event: MouseEvent): void; destroy(): void } {
	const { host } = options;
	const grip = el("div", "col-resizer");
	grip.hidden = true;
	host.append(grip);

	let gap: Gap | null = null;
	let dragging = false;

	/** The gap at the pointer: the middle third, so the next column's block handle stays usable. */
	const gapAt = (event: MouseEvent): Gap | null => {
		const row = (event.target as Element).closest<HTMLElement>(".ne-columns");
		if (!row || !host.contains(row)) return null;
		const cols = columnsOf(row);
		for (let i = 0; i < cols.length - 1; i++) {
			const a = cols[i]!.getBoundingClientRect();
			const b = cols[i + 1]!.getBoundingClientRect();
			const mid = (a.right + b.left) / 2;
			if (Math.abs(event.clientX - mid) > Math.max(4, (b.left - a.right) / 6)) continue;
			const hostRect = host.getBoundingClientRect();
			const rowRect = row.getBoundingClientRect();
			Object.assign(grip.style, {
				left: `${mid - hostRect.left - 2}px`,
				top: `${rowRect.top - hostRect.top}px`,
				height: `${rowRect.height}px`,
			});
			return { row, index: i };
		}
		return null;
	};

	grip.addEventListener("pointerdown", (event) => {
		if (!gap) return;
		event.preventDefault();
		dragging = true;
		const { row, index } = gap;
		const widths = options.widthsOf(row);
		const cols = columnsOf(row);
		const a = cols[index]!.getBoundingClientRect();
		const b = cols[index + 1]!.getBoundingClientRect();
		let next = widths;
		dragWith(
			grip,
			event,
			(ev) => {
				// Where the pointer sits between the pair's outer edges sets the split.
				next = splitAt(widths, index, ev.clientX, a.left, b.right);
				row.style.gridTemplateColumns = gridTemplate(next);
				grip.style.left = `${ev.clientX - host.getBoundingClientRect().left - 2}px`;
			},
			() => {
				dragging = false;
				if (next !== widths) options.onResize(row, next);
			},
		);
	});

	return {
		grip,
		hover(event) {
			if (dragging || event.buttons || event.target === grip) return;
			gap = gapAt(event);
			grip.hidden = gap === null;
		},
		destroy: () => grip.remove(),
	};
}
