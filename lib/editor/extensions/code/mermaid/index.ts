import { CodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";

import { $getMermaidView, $isMermaidBlock, mermaidMessage, type MermaidView } from "./logic.ts";
import { drawMermaid } from "./render.ts";
import { clearMermaid, hasPicture, isOnPicture, paintMermaid, showMermaidView } from "./view.ts";
import { openMermaidViewer } from "./viewer.ts";

export {
	$chooseMermaidView,
	$getMermaidView,
	$insertMermaid,
	$isMermaidBlock,
	MERMAID_STARTER,
	mermaidViewState,
	type MermaidView,
} from "./logic.ts";

/** Opens a diagram full-window, to zoom and pan (nothing happens if it doesn't draw). */
export function viewMermaid(source: string): void {
	if (!source.trim()) return;
	drawMermaid(source).then(openMermaidViewer, () => {});
}

/** Draws the diagram of every Mermaid code block, keeping it in step with edits. */
export function registerMermaid(editor: LexicalEditor): () => void {
	/** Code blocks on the page (Mermaid or not: a block can switch language). */
	const keys = new Set<NodeKey>();
	/** The source each block's element shows now, to skip unchanged blocks. */
	const shown = new Map<NodeKey, string>();
	const timers = new Map<NodeKey, number>();

	const sync = () => {
		const blocks = editor.read(() => {
			const out: { key: NodeKey; source: string; view: MermaidView }[] = [];
			for (const key of keys) {
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
			if (dom) clearMermaid(dom);
			shown.delete(key);
		}
		for (const { key, source, view } of blocks) {
			const dom = editor.getElementByKey(key);
			if (!dom) continue;
			showMermaidView(dom, view);
			// Lexical re-creates the element sometimes; a fresh one has no picture yet.
			if (shown.get(key) === source && hasPicture(dom)) continue;
			shown.set(key, source);
			clearTimeout(timers.get(key));
			const current = () => shown.get(key) === source;
			const run = () => {
				if (!source.trim()) return paintMermaid(dom, { error: "Write a diagram to see it here." });
				if (!hasPicture(dom)) paintMermaid(dom, null);
				drawMermaid(source).then(
					(drawn) => current() && paintMermaid(dom, drawn),
					(error: unknown) =>
						current() && paintMermaid(dom, { error: mermaidMessage(error, source) }),
				);
			};
			// Right away on load; while typing, once there's a pause.
			if (hasPicture(dom)) timers.set(key, window.setTimeout(run, 350));
			else run();
		}
	};

	/** Clicking a drawn diagram opens it full-window. */
	const onClick = (event: MouseEvent) => {
		const dom = (event.target as Element | null)?.closest<HTMLElement>(".ne-code");
		if (!dom || !isOnPicture(dom, event.clientY)) return;
		const key = [...keys].find((k) => editor.getElementByKey(k) === dom);
		if (!key) return;
		viewMermaid(
			editor.read(() => {
				const node = $getNodeByKey(key);
				return $isMermaidBlock(node) ? node.getTextContent() : "";
			}),
		);
	};

	return mergeRegister(
		editor.registerMutationListener(
			CodeNode,
			(mutations) => {
				for (const [key, mutation] of mutations) {
					if (mutation === "destroyed") keys.delete(key);
					else keys.add(key);
				}
			},
			{ skipInitialization: false },
		),
		editor.registerUpdateListener(sync),
		editor.registerRootListener((root, prev) => {
			prev?.removeEventListener("click", onClick);
			root?.addEventListener("click", onClick);
		}),
		() => editor.getRootElement()?.removeEventListener("click", onClick),
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
