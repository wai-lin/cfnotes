import { $isCodeNode, CodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import {
	$getNodeByKey,
	$getState,
	$setState,
	createState,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
} from "lexical";

import { resolveLanguage } from "./code-languages";

/**
 * Mermaid diagrams in code blocks. A code block in the Mermaid language shows
 * its diagram as Code (source only), Preview (diagram only) or Split (source
 * with the diagram below), saved on the block.
 *
 * The diagram is drawn by CSS (`::after` with the SVG as its background), not
 * as DOM inside the block: Lexical owns that DOM and would undo extra nodes.
 * As an image it also flows with the text, prints, and needs no positioning.
 */

export type MermaidView = "code" | "preview" | "split";
const VIEWS: MermaidView[] = ["code", "preview", "split"];

/** The block's view, stored with it (`$` in its JSON). Split unless chosen. */
export const mermaidViewState = createState("mermaidView", {
	parse: (value): MermaidView =>
		VIEWS.includes(value as MermaidView) ? (value as MermaidView) : "split",
});

export function $isMermaidBlock(node: LexicalNode | null | undefined): node is CodeNode {
	return $isCodeNode(node) && resolveLanguage(node.getLanguage()) === "mermaid";
}

export function $getMermaidView(node: CodeNode): MermaidView {
	return $getState(node, mermaidViewState);
}

export function $setMermaidView(node: CodeNode, view: MermaidView): void {
	$setState(node, mermaidViewState, view);
}

/** A diagram to start from (`/mermaid`). */
export const MERMAID_STARTER = `flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Great]
  B -->|No| D[Check the syntax]
  D --> B`;

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

interface Drawn {
	svg: string;
	width: number;
	height: number;
}

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
function drawn(source: string): Promise<Drawn> {
	const key = source;
	let hit = cache.get(key);
	if (!hit) {
		hit = render(source);
		cache.set(key, hit);
		hit.catch(() => cache.delete(key));
		if (cache.size > 100) cache.delete(cache.keys().next().value!);
	}
	return hit;
}

/** Shows `result` on a code block's element (see `.ne-code[data-mermaid]` in site.css). */
function paint(dom: HTMLElement, result: Drawn | { error: string } | null): void {
	if (!result) {
		dom.dataset.mermaidState = "loading";
		return;
	}
	if ("error" in result) {
		dom.dataset.mermaidState = "error";
		dom.dataset.mermaidError = result.error;
		dom.style.removeProperty("--mermaid-img");
		return;
	}
	dom.dataset.mermaidState = "ok";
	delete dom.dataset.mermaidError;
	dom.style.setProperty(
		"--mermaid-img",
		`url("data:image/svg+xml,${encodeURIComponent(result.svg)}")`,
	);
	dom.style.setProperty("--mermaid-w", `${result.width}px`);
	dom.style.setProperty("--mermaid-ratio", `${result.width} / ${result.height}`);
}

function clear(dom: HTMLElement): void {
	for (const key of ["mermaid", "mermaidState", "mermaidError"]) delete dom.dataset[key];
	for (const prop of ["--mermaid-img", "--mermaid-w", "--mermaid-ratio"])
		dom.style.removeProperty(prop);
}

/**
 * A Mermaid error in one line: "Parse error on line 6: unexpected end of the
 * diagram" rather than its parser trace and list of expected tokens.
 */
export function mermaidMessage(error: unknown, source: string): string {
	const text = error instanceof Error ? error.message : String(error);
	const lines = text.split("\n").map((line) => line.trim());
	// An error at the end is reported on the line after the last one; say the last.
	const last = Math.max(1, source.replace(/\s+$/, "").split("\n").length);
	const first = (lines.find(Boolean) ?? "Invalid diagram")
		.replace(/:$/, "")
		.replace(/\bline (\d+)/, (_, n: string) => `line ${Math.min(Number(n), last)}`);
	const got = lines.find((line) => line.startsWith("Expecting"))?.match(/got '([^']+)'\s*$/)?.[1];
	const detail = got
		? got === "EOF"
			? "unexpected end of the diagram"
			: `unexpected ${got.toLowerCase().replace(/_/g, " ")}`
		: "";
	return `${first}${detail ? `: ${detail}` : ""}`.slice(0, 200);
}

/** Draws the diagram of every Mermaid code block, keeping it in step with edits. */
export function registerMermaid(editor: LexicalEditor): () => void {
	/** What each block's element shows now, to skip unchanged blocks. */
	const shown = new Map<NodeKey, string>();
	const timers = new Map<NodeKey, number>();

	const sync = () => {
		const blocks = editor.read(() => {
			const out: { key: NodeKey; source: string; view: MermaidView }[] = [];
			for (const [key] of keys) {
				const node = $getNodeByKey(key);
				if ($isMermaidBlock(node))
					out.push({ key, source: node.getTextContent(), view: $getMermaidView(node) });
			}
			return out;
		});
		const live = new Set(blocks.map((b) => b.key));
		for (const key of shown.keys()) {
			if (live.has(key)) continue;
			const dom = editor.getElementByKey(key);
			if (dom) clear(dom);
			shown.delete(key);
		}
		for (const { key, source, view } of blocks) {
			const dom = editor.getElementByKey(key);
			if (!dom) continue;
			dom.dataset.mermaid = view;
			const stamp = source;
			// Lexical re-creates the element sometimes; a fresh one has no picture yet.
			if (shown.get(key) === stamp && dom.dataset.mermaidState) continue;
			shown.set(key, stamp);
			clearTimeout(timers.get(key));
			const run = () => {
				if (!source.trim()) return paint(dom, { error: "Write a diagram to see it here." });
				if (!dom.dataset.mermaidState) paint(dom, null);
				drawn(source).then(
					(result) => shown.get(key) === stamp && paint(dom, result),
					(error: unknown) =>
						shown.get(key) === stamp && paint(dom, { error: mermaidMessage(error, source) }),
				);
			};
			// Right away on load; while typing, once there's a pause.
			if (dom.dataset.mermaidState) timers.set(key, window.setTimeout(run, 350));
			else run();
		}
	};

	/** Code blocks on the page (Mermaid or not: a block can switch language). */
	const keys = new Map<NodeKey, true>();

	return mergeRegister(
		editor.registerMutationListener(
			CodeNode,
			(mutations) => {
				for (const [key, mutation] of mutations) {
					if (mutation === "destroyed") keys.delete(key);
					else keys.set(key, true);
				}
			},
			{ skipInitialization: false },
		),
		editor.registerUpdateListener(sync),
		// Blocks already on the page when it loads.
		(() => {
			const frame = requestAnimationFrame(sync);
			return () => cancelAnimationFrame(frame);
		})(),
		() => {
			for (const timer of timers.values()) clearTimeout(timer);
		},
	);
}

/** Sets a Mermaid block's view. Call inside `editor.update`. */
export function $chooseMermaidView(key: NodeKey, view: MermaidView): void {
	const node = $getNodeByKey(key);
	if ($isMermaidBlock(node)) $setMermaidView(node, view);
}
