type Katex = typeof import("katex").default;

let loading: Promise<Katex> | null = null;
let katex: Katex | null = null;

/**
 * KaTeX (and its stylesheet and fonts) load the first time a page shows an
 * equation, so pages without math never download them.
 */
export function loadKatex(): Promise<Katex> {
	loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")])
		.then(([mod]) => (katex = mod.default))
		.catch((error: unknown) => {
			loading = null; // try again next time
			throw error;
		});
	return loading;
}

/**
 * Renders `tex` into `el`: right away once KaTeX is here, otherwise as the
 * source text until it arrives. Bad TeX shows KaTeX's error in red instead of
 * throwing. `display` is a centered block equation; otherwise inline.
 */
export function renderMath(el: HTMLElement, tex: string, display: boolean): void {
	el.dataset.tex = tex;
	const draw = (k: Katex) => {
		if (el.dataset.tex !== tex) return; // changed while loading
		k.render(tex, el, { displayMode: display, throwOnError: false, strict: "ignore" });
	};
	if (katex) {
		draw(katex);
		return;
	}
	el.textContent = tex;
	loadKatex()
		.then(draw)
		.catch((error: unknown) => console.error("[notes-editor] could not load KaTeX", error));
}
