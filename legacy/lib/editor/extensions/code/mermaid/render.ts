/** Drawing Mermaid source to SVG: loaded on demand, one render at a time, cached. */

export interface Drawn {
	svg: string;
	width: number;
	height: number;
}

type Mermaid = typeof import("mermaid").default;
let loading: Promise<Mermaid> | null = null;

/** Mermaid is big: it loads the first time a page shows a diagram. */
function loadMermaid(): Promise<Mermaid> {
	loading ??= import("mermaid")
		.then((mod) => mod.default)
		.catch((error: unknown) => {
			loading = null;
			throw error;
		});
	return loading;
}

let renders = 0;
/** Renders run one at a time: Mermaid keeps global state while it draws. */
let queue: Promise<unknown> = Promise.resolve();
let configured = false;

/**
 * Renders `source` to SVG, or throws Mermaid's error. Always the light theme:
 * dark mode inverts the picture in CSS, since Mermaid's theme can't be switched
 * reliably once it has drawn.
 */
function render(source: string): Promise<Drawn> {
	const job = queue.then(async () => {
		const mermaid = await loadMermaid();
		if (!configured) {
			mermaid.initialize({
				startOnLoad: false,
				securityLevel: "strict",
				theme: "default",
				fontFamily:
					"ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
				// Labels as SVG text, not HTML: the diagram is shown as an image, which can't hold HTML.
				htmlLabels: false,
				flowchart: { htmlLabels: false },
			});
			configured = true;
		}
		const id = `cf-mermaid-${++renders}`;
		try {
			const { svg } = await mermaid.render(id, source);
			const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
			const root = doc.documentElement;
			const box =
				root
					.getAttribute("viewBox")
					?.split(/[\s,]+/)
					.map(Number) ?? [];
			const width = box[2] || Number.parseFloat(root.getAttribute("width") ?? "") || 600;
			const height = box[3] || Number.parseFloat(root.getAttribute("height") ?? "") || 300;
			// A fixed size, so it scales as an image instead of stretching to 100%.
			root.setAttribute("width", String(width));
			root.setAttribute("height", String(height));
			root.removeAttribute("style");
			return { svg: new XMLSerializer().serializeToString(root), width, height };
		} finally {
			// A failed render leaves its scratch element behind.
			document.getElementById(`d${id}`)?.remove();
			document.getElementById(id)?.remove();
		}
	});
	queue = job.catch(() => {});
	return job;
}

/** The last result per source text, so re-creating a block doesn't re-render it. */
const cache = new Map<string, Promise<Drawn>>();

export function drawMermaid(source: string): Promise<Drawn> {
	let hit = cache.get(source);
	if (!hit) {
		hit = render(source);
		cache.set(source, hit);
		hit.catch(() => cache.delete(source));
		if (cache.size > 100) cache.delete(cache.keys().next().value!);
	}
	return hit;
}
