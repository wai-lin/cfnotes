/**
 * The diagram is drawn by CSS (`::after` with the SVG as its background), not
 * as DOM inside the block: Lexical owns that DOM and would undo extra nodes.
 * As an image it also flows with the text, prints, and needs no positioning.
 * See `.ne-code[data-mermaid]` in the styles.
 */
import type { MermaidView } from "./logic";
import type { Drawn } from "./render";

export type MermaidPicture = Drawn | { error: string } | null;

/** Shows Code, Preview or Split on a code block's element. */
export function showMermaidView(dom: HTMLElement, view: MermaidView): void {
	dom.dataset.mermaid = view;
}

/** Shows the picture (`null` while it's drawn) on a code block's element. */
export function paintMermaid(dom: HTMLElement, picture: MermaidPicture): void {
	if (!picture) {
		dom.dataset.mermaidState = "loading";
		return;
	}
	if ("error" in picture) {
		dom.dataset.mermaidState = "error";
		dom.dataset.mermaidError = picture.error;
		dom.style.removeProperty("--mermaid-img");
		return;
	}
	dom.dataset.mermaidState = "ok";
	delete dom.dataset.mermaidError;
	dom.style.setProperty(
		"--mermaid-img",
		`url("data:image/svg+xml,${encodeURIComponent(picture.svg)}")`,
	);
	dom.style.setProperty("--mermaid-w", `${picture.width}px`);
	dom.style.setProperty("--mermaid-ratio", `${picture.width} / ${picture.height}`);
}

/** Whether the element already shows a picture (or is drawing one). */
export const hasPicture = (dom: HTMLElement) => !!dom.dataset.mermaidState;

/** Back to a plain code block. */
export function clearMermaid(dom: HTMLElement): void {
	for (const key of ["mermaid", "mermaidState", "mermaidError"]) delete dom.dataset[key];
	for (const prop of ["--mermaid-img", "--mermaid-w", "--mermaid-ratio"])
		dom.style.removeProperty(prop);
}
