/** Column widths: shares of the row that add up to 1. Pure, for the nodes, the view and tests. */

/** The narrowest a column can be dragged. */
export const MIN_SHARE = 0.12;

export const equalWidths = (count: number) => Array.from({ length: count }, () => 1 / count);

export function gridTemplate(widths: number[]): string {
	return widths.map((w) => `minmax(0, ${w.toFixed(4)}fr)`).join(" ");
}

/** Whether `widths` fit `count` columns and add up to 1. */
export function validWidths(widths: number[], count: number): boolean {
	const total = widths.reduce((a, b) => a + b, 0);
	return widths.length === count && Math.abs(total - 1) <= 0.001;
}

/**
 * The widths after dragging the gap after column `index` to `x`, where the
 * pair spans `left`…`right` on screen: the pair's total stays, split where
 * the pointer is (no narrower than `MIN_SHARE` of it).
 */
export function splitAt(
	widths: number[],
	index: number,
	x: number,
	left: number,
	right: number,
): number[] {
	const pair = (widths[index] ?? 0) + (widths[index + 1] ?? 0);
	const share = Math.min(Math.max((x - left) / (right - left), MIN_SHARE), 1 - MIN_SHARE);
	const next = [...widths];
	next[index] = pair * share;
	next[index + 1] = pair * (1 - share);
	return next;
}
