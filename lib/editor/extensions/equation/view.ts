import { el, isolateInput } from "../../shared/dom.ts";
import { renderMath } from "./katex.ts";

/** An equation's DOM: a wrapper (inline or block) around the rendered math. */
export function createEquationElement(tex: string, inline: boolean): HTMLElement {
	const wrap = el(inline ? "span" : "div", `ne-eq ${inline ? "ne-eq-inline" : "ne-eq-block"}`);
	wrap.contentEditable = "false";
	wrap.append(el(inline ? "span" : "div", "ne-eq-math"));
	drawEquation(wrap, tex, !inline);
	return wrap;
}

/** Draws `tex` into an equation's DOM, or its "empty" prompt. */
export function drawEquation(wrap: HTMLElement, tex: string, display: boolean): void {
	const math = wrap.querySelector<HTMLElement>(".ne-eq-math");
	if (!math) return;
	const empty = tex.trim() === "";
	wrap.classList.toggle("is-empty", empty);
	if (empty) {
		delete math.dataset.tex;
		math.textContent = display ? "Add a TeX equation" : "New equation";
	} else renderMath(math, tex, display);
}

/** What the equation editor is editing. */
export interface EquationTarget {
	inline: boolean;
	original: string;
	/** The equation's element (drawn live while typing). */
	wrap: HTMLElement;
}

export interface EquationEditorView {
	element: HTMLElement;
	/** Opens on `target` with its TeX in the box; null closes. */
	render(target: EquationTarget | null): void;
	/** Moves the popover under its equation again. */
	place(): void;
	value(): string;
	destroy(): void;
}

/**
 * The popover for editing an equation's TeX: a growing textarea and Done.
 * Enter is Done, ⇧Enter a new line, Escape cancels. What's typed is drawn
 * into the equation as it changes (saved on Done).
 */
export function createEquationEditorView(options: {
	maxLength: number;
	onDone: () => void;
	onCancel: () => void;
}): EquationEditorView {
	const pop = el("div", "eq-pop");
	pop.hidden = true;
	const input = el("textarea", "eq-input");
	input.rows = 1;
	input.spellcheck = false;
	input.maxLength = options.maxLength;
	input.placeholder = "E = mc^2";
	input.setAttribute("aria-label", "TeX equation");
	const foot = el("div", "eq-foot");
	const hint = el("a", "eq-hint", "Supported functions");
	hint.href = "https://katex.org/docs/supported.html";
	hint.target = "_blank";
	hint.rel = "noopener";
	const done = el("button", "eq-done", "Done ↵");
	done.type = "button";
	foot.append(hint, done);
	pop.append(input, foot);
	document.body.append(pop);

	let target: EquationTarget | null = null;

	const grow = () => {
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 240)}px`;
	};
	const place = () => {
		if (!target) return;
		const rect = target.wrap.getBoundingClientRect();
		const width = Math.min(target.inline ? 380 : 520, innerWidth - 16);
		const left = target.inline
			? Math.min(Math.max(rect.left, 8), innerWidth - width - 8)
			: rect.left + (rect.width - width) / 2;
		pop.style.width = `${width}px`;
		pop.style.left = `${left + scrollX}px`;
		pop.style.top = `${rect.bottom + scrollY + 6}px`;
	};

	// The textarea's keys stay out of the editor and the page's shortcuts.
	isolateInput(input, ["keydown", "keypress", "keyup", "paste", "copy", "cut"]);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			options.onCancel();
		} else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			options.onDone();
		}
	});
	input.addEventListener("input", () => {
		grow();
		if (target) drawEquation(target.wrap, input.value, !target.inline);
		place();
	});
	done.addEventListener("click", options.onDone);

	return {
		element: pop,
		render(next) {
			if (target && target !== next) {
				target.wrap.classList.remove("is-editing");
				input.blur();
			}
			target = next;
			pop.hidden = !next;
			if (!next) return;
			next.wrap.classList.add("is-editing");
			input.value = next.original;
			place();
			grow();
			input.focus();
			input.select();
		},
		place,
		value: () => input.value,
		destroy: () => pop.remove(),
	};
}
