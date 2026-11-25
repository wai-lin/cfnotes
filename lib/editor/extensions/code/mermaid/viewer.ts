/**
 * A full-window viewer for one diagram: zoom (wheel, pinch, buttons, keys),
 * pan (drag, arrow keys), fit and actual size. A modal `<dialog>` on the body,
 * outside the editor, so Lexical never sees it; Escape or Close ends it.
 */
import { el, iconButton, listen } from "../../../shared/dom.ts";
import { centred, fit, panBy, wheelFactor, zoomAt, type Camera } from "./camera.ts";
import type { Drawn } from "./render.ts";

const STEP = 1.25;
const PAN = 60;

export function openMermaidViewer(drawn: Drawn): void {
	const restore = document.activeElement as HTMLElement | null;
	const size = { width: drawn.width, height: drawn.height };

	const dialog = el("dialog", "mermaid-viewer");
	dialog.setAttribute("aria-label", "Diagram");

	const bar = el("div", "mermaid-viewer-bar");
	const zoomOut = iconButton("mermaid-viewer-btn", "Zoom out", "zoomOut", 16);
	const level = el("button", "mermaid-viewer-btn mermaid-viewer-level", "100%");
	level.type = "button";
	level.title = "Actual size (1)";
	level.setAttribute("aria-label", "Actual size");
	const zoomIn = iconButton("mermaid-viewer-btn", "Zoom in", "zoomIn", 16);
	const fitButton = iconButton("mermaid-viewer-btn", "Fit to window", "focusCentered", 16);
	const close = iconButton("mermaid-viewer-btn", "Close", "x", 16);
	zoomOut.title = "Zoom out (−)";
	zoomIn.title = "Zoom in (+)";
	fitButton.title = "Fit to window (0)";
	close.title = "Close (Esc)";
	const hint = el("span", "mermaid-viewer-hint", "Scroll or pinch to zoom · drag to pan");
	bar.append(hint, zoomOut, level, zoomIn, fitButton, close);

	const stage = el("div", "mermaid-viewer-stage");
	// Focusable, so the keys work from the start.
	stage.tabIndex = -1;
	const img = el("img", "mermaid-viewer-img");
	img.alt = "Diagram";
	img.draggable = false;
	img.src = `data:image/svg+xml,${encodeURIComponent(drawn.svg)}`;
	stage.append(img);
	dialog.append(bar, stage);
	document.body.append(dialog);

	let camera: Camera = { x: 0, y: 0, scale: 1 };
	/** Until the reader zooms or pans, a resize fits the diagram again. */
	let touched = false;
	const stageSize = () => ({ width: stage.clientWidth, height: stage.clientHeight });

	const paint = () => {
		// Sized rather than scaled, so the SVG is redrawn sharp at every zoom.
		img.style.width = `${size.width * camera.scale}px`;
		img.style.height = `${size.height * camera.scale}px`;
		img.style.transform = `translate(${camera.x}px, ${camera.y}px)`;
		level.textContent = `${Math.round(camera.scale * 100)}%`;
	};
	const set = (next: Camera, byReader = true) => {
		camera = next;
		if (byReader) touched = true;
		paint();
	};
	const centre = () => {
		const { width, height } = stageSize();
		return [width / 2, height / 2] as const;
	};
	const zoomBy = (factor: number) => set(zoomAt(camera, factor, ...centre()));
	const fitNow = (byReader = true) => set(fit(size, stageSize()), byReader);

	zoomIn.addEventListener("click", () => zoomBy(STEP));
	zoomOut.addEventListener("click", () => zoomBy(1 / STEP));
	level.addEventListener("click", () => set(centred(size, stageSize(), 1)));
	fitButton.addEventListener("click", () => fitNow());
	close.addEventListener("click", () => dialog.close());

	// ---- pointer: drag to pan, two fingers to pinch ----
	const pointers = new Map<number, { x: number; y: number }>();
	const local = (event: { clientX: number; clientY: number }) => {
		const rect = stage.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};
	const pinch = () => {
		const [a, b] = [...pointers.values()];
		return {
			mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
			gap: Math.hypot(a!.x - b!.x, a!.y - b!.y),
		};
	};
	stage.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		stage.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, local(event));
		stage.classList.add("is-dragging");
	});
	stage.addEventListener("pointermove", (event) => {
		const before = pointers.get(event.pointerId);
		if (!before) return;
		if (pointers.size === 1) {
			const now = local(event);
			pointers.set(event.pointerId, now);
			set(panBy(camera, now.x - before.x, now.y - before.y));
			return;
		}
		const was = pinch();
		pointers.set(event.pointerId, local(event));
		const is = pinch();
		const moved = panBy(camera, is.mid.x - was.mid.x, is.mid.y - was.mid.y);
		set(was.gap > 0 ? zoomAt(moved, is.gap / was.gap, is.mid.x, is.mid.y) : moved);
	});
	const lift = (event: PointerEvent) => {
		pointers.delete(event.pointerId);
		if (pointers.size === 0) stage.classList.remove("is-dragging");
	};
	stage.addEventListener("pointerup", lift);
	stage.addEventListener("pointercancel", lift);
	stage.addEventListener("dblclick", (event) => {
		const p = local(event);
		set(zoomAt(camera, event.shiftKey ? 1 / 2 : 2, p.x, p.y));
	});
	stage.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			const p = local(event);
			set(zoomAt(camera, wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey), p.x, p.y));
		},
		{ passive: false },
	);

	// ---- keys ----
	dialog.addEventListener("keydown", (event) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const actions: Record<string, () => void> = {
			"+": () => zoomBy(STEP),
			"=": () => zoomBy(STEP),
			"-": () => zoomBy(1 / STEP),
			_: () => zoomBy(1 / STEP),
			"0": () => fitNow(),
			"1": () => set(centred(size, stageSize(), 1)),
			ArrowLeft: () => set(panBy(camera, PAN, 0)),
			ArrowRight: () => set(panBy(camera, -PAN, 0)),
			ArrowUp: () => set(panBy(camera, 0, PAN)),
			ArrowDown: () => set(panBy(camera, 0, -PAN)),
		};
		const action = actions[event.key];
		if (!action) return;
		event.preventDefault();
		action();
	});

	const resizes = new ResizeObserver(() => {
		if (!touched) fitNow(false);
	});
	const offResize = listen(window, "resize", () => {
		if (!touched) fitNow(false);
	});
	dialog.addEventListener("close", () => {
		resizes.disconnect();
		offResize();
		dialog.remove();
		restore?.focus({ preventScroll: true });
	});

	dialog.showModal();
	stage.focus();
	fitNow(false);
	resizes.observe(stage);
}
