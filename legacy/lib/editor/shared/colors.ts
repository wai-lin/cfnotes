/** Notion's text and highlight palettes. `null` restores the default. */
export type Palette = [name: string, value: string | null][];

export const TEXT_COLORS: Palette = [
	["Default", null],
	["Gray", "#787774"],
	["Brown", "#9f6b53"],
	["Orange", "#d9730d"],
	["Yellow", "#cb912f"],
	["Green", "#448361"],
	["Blue", "#337ea9"],
	["Purple", "#9065b0"],
	["Pink", "#c14c8a"],
	["Red", "#d44c47"],
];

export const BACK_COLORS: Palette = [
	["Default", null],
	["Gray", "#f1f1ef"],
	["Brown", "#f4eeee"],
	["Orange", "#faebdd"],
	["Yellow", "#fbf3db"],
	["Green", "#edf3ec"],
	["Blue", "#e7f3f8"],
	["Purple", "#f6f3f9"],
	["Pink", "#faf1f5"],
	["Red", "#fdebec"],
];

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Parses the `rgb(…)`/`rgba(…)` form browsers report for inline styles; null if transparent-ish. */
function parseRgb(css: string): RGB | null {
	const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(css.trim());
	if (!m) return null;
	if (m[4] !== undefined) {
		const alpha = m[4].endsWith("%") ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]);
		if (alpha < 0.5) return null;
	}
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * The palette color a pasted CSS color stands for, or null. Only near matches
 * count, so a web page's ordinary text and background colors are dropped while
 * Notion's (and our own) colors survive a round trip.
 */
export function snapToPalette(css: string, palette: Palette): string | null {
	const rgb = parseRgb(css);
	if (!rgb) return null;
	let best: string | null = null;
	let bestDistance = Infinity;
	for (const [, hex] of palette) {
		if (!hex) continue;
		const [r, g, b] = hexToRgb(hex);
		const distance = Math.hypot(r - rgb[0], g - rgb[1], b - rgb[2]);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = hex;
		}
	}
	return bestDistance <= 24 ? best : null;
}
