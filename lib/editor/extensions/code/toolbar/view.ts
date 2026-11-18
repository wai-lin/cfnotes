import type { NodeKey } from "lexical";

import { el, highlightItems, onPointerHover } from "../../../shared/dom";
import { icon } from "../../../shared/icons";
import { searchLanguages, type LanguageOption } from "../languages";
import type { MermaidView } from "../mermaid/logic";
import type { CodeToolbarState } from "./state";

const VIEW_LABELS: [MermaidView, string][] = [
	["code", "Code"],
	["preview", "Preview"],
	["split", "Split"],
];

interface Bar {
	root: HTMLDivElement;
	lang: HTMLButtonElement;
	/** Code / Preview / Split, on Mermaid blocks only. */
	views: HTMLDivElement;
	copy: HTMLButtonElement;
	timer: number;
}

function setCopyLabel(button: HTMLButtonElement, copied: boolean) {
	button.innerHTML = `${icon(copied ? "check" : "copy", 14)}<span>${copied ? "Copied" : "Copy"}</span>`;
}

export interface CodeToolbarView {
	render(state: CodeToolbarState, prev?: CodeToolbarState): void;
	/** Lays the bars out again (the blocks moved). */
	layout(): void;
	/** Shows "Copied" on a block's bar for a moment. */
	flashCopied(key: NodeKey): void;
	/** Whether a press on `node` belongs to the open picker (or its button). */
	ownsPress(node: Node): boolean;
	destroy(): void;
}

/**
 * A bar over every code block (language button, Copy, and on Mermaid blocks a
 * Code / Preview / Split switch), and the language picker. The bars live in
 * `host`, outside the contenteditable, so Lexical never sees them.
 */
export function createCodeToolbarView(options: {
	host: HTMLElement;
	blockElement: (key: NodeKey) => HTMLElement | null;
	onToggleMenu: (key: NodeKey) => void;
	onCopy: (key: NodeKey) => void;
	onView: (key: NodeKey, view: MermaidView) => void;
	onLanguage: (key: NodeKey, language: string) => void;
	onCloseMenu: (refocus: boolean) => void;
}): CodeToolbarView {
	const { host } = options;
	const bars = new Map<NodeKey, Bar>();
	let state: CodeToolbarState = { blocks: [], menuKey: null };

	const createBar = (key: NodeKey): Bar => {
		const root = el("div", "code-bar");
		const lang = el("button", "code-lang");
		lang.innerHTML = `<span class="code-lang-name"></span>${icon("chevronDown", 14)}`;
		const copy = el("button", "code-copy");
		setCopyLabel(copy, false);
		lang.type = copy.type = "button";
		lang.setAttribute("aria-haspopup", "listbox");
		const views = el("div", "code-views");
		views.setAttribute("role", "group");
		views.setAttribute("aria-label", "Diagram view");
		views.hidden = true;
		for (const [view, label] of VIEW_LABELS) {
			const button = el("button", "code-view", label);
			button.type = "button";
			button.dataset.view = view;
			views.append(button);
		}
		const right = el("div", "code-bar-right");
		right.append(views, copy);
		root.dataset.key = key;
		root.append(lang, right);
		host.append(root);
		return { root, lang, views, copy, timer: 0 };
	};

	const removeBar = (key: NodeKey) => {
		const bar = bars.get(key);
		if (!bar) return;
		clearTimeout(bar.timer);
		bar.root.remove();
		bars.delete(key);
	};

	/** Puts each bar over the top padding of its code block and refreshes its label. */
	const layout = () => {
		const outer = host.getBoundingClientRect();
		for (const block of state.blocks) {
			const bar = bars.get(block.key);
			if (!bar) continue;
			const dom = options.blockElement(block.key);
			bar.root.hidden = !dom;
			if (!dom) continue;
			const label = bar.lang.firstElementChild!;
			if (label.textContent !== block.language) label.textContent = block.language;
			bar.views.hidden = block.view === null;
			for (const button of bar.views.children as HTMLCollectionOf<HTMLElement>) {
				const on = button.dataset.view === block.view;
				button.classList.toggle("is-active", on);
				button.setAttribute("aria-pressed", String(on));
			}
			const rect = dom.getBoundingClientRect();
			bar.root.style.top = `${rect.top - outer.top + 6}px`;
			bar.root.style.left = `${rect.left - outer.left + 8}px`;
			bar.root.style.width = `${rect.width - 16}px`;
		}
		if (!menu.hidden) place();
	};

	// Keep the editor's focus and selection when pressing a bar's buttons.
	const barKey = (target: EventTarget | null) =>
		(target as Element | null)?.closest<HTMLElement>(".code-bar")?.dataset.key ?? null;
	const onMouseDown = (event: MouseEvent) => {
		if (barKey(event.target)) event.preventDefault();
	};
	const onClick = (event: MouseEvent) => {
		const key = barKey(event.target);
		const button = (event.target as Element).closest("button");
		if (!key || !button) return;
		const view = button.dataset.view as MermaidView | undefined;
		if (view) options.onView(key, view);
		else if (button.classList.contains("code-copy")) options.onCopy(key);
		else options.onToggleMenu(key);
	};
	host.addEventListener("mousedown", onMouseDown);
	host.addEventListener("click", onClick);

	// ---- language picker ----
	const menu = el("div", "lang-menu");
	const search = el("input", "lang-search");
	search.type = "text";
	search.placeholder = "Search for a language…";
	search.setAttribute("aria-label", "Search for a language");
	const list = el("div", "lang-list");
	list.setAttribute("role", "listbox");
	menu.append(search, list);
	menu.hidden = true;
	document.body.append(menu);

	let shown: LanguageOption[] = [];
	let active = 0;
	const highlight = () => highlightItems(list, ".lang-item", active);
	const current = () => state.blocks.find((block) => block.key === state.menuKey)?.languageId ?? "";

	const fill = () => {
		const q = search.value.trim();
		shown = searchLanguages(q);
		const selected = current();
		active = q
			? 0
			: Math.max(
					0,
					shown.findIndex((o) => o.id === selected),
				);
		list.replaceChildren(
			...shown.map((option, index) => {
				const item = el("button", "lang-item");
				item.type = "button";
				item.setAttribute("role", "option");
				item.dataset.index = String(index);
				item.append(el("span", "lang-name", option.name));
				if (option.id === selected) {
					const mark = el("span", "lang-check");
					mark.innerHTML = icon("check", 14);
					item.append(mark);
				}
				return item;
			}),
		);
		if (shown.length === 0) list.append(el("div", "lang-empty", "No results"));
		highlight();
	};

	const place = () => {
		const button = state.menuKey ? bars.get(state.menuKey)?.lang : undefined;
		if (!button) return;
		const rect = button.getBoundingClientRect();
		const below = rect.bottom + 4;
		const fits = below + menu.offsetHeight < innerHeight - 8;
		menu.style.top = `${fits ? below : Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
	};

	const choose = (index: number) => {
		const option = shown[index];
		if (option && state.menuKey) options.onLanguage(state.menuKey, option.id);
	};

	search.addEventListener("input", fill);
	search.addEventListener("keydown", (event) => {
		const n = shown.length;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (n) active = (active + (event.key === "ArrowDown" ? 1 : -1) + n) % n;
			highlight();
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(active);
		} else if (event.key === "Escape") {
			event.preventDefault();
			options.onCloseMenu(true);
		} else if (event.key === "Tab") {
			options.onCloseMenu(false);
		}
	});
	// Same rule as the slash menu: only real pointer movement moves the highlight.
	onPointerHover(list, ".lang-item", (index) => {
		if (index === active) return;
		active = index;
		highlight();
	});
	list.addEventListener("mousedown", (event) => event.preventDefault());
	list.addEventListener("click", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".lang-item");
		if (item) choose(Number(item.dataset.index));
	});

	return {
		render(next, prev) {
			state = next;
			if (next.blocks !== prev?.blocks) {
				const live = new Set(next.blocks.map((block) => block.key));
				for (const key of bars.keys()) if (!live.has(key)) removeBar(key);
				for (const block of next.blocks)
					if (!bars.has(block.key)) bars.set(block.key, createBar(block.key));
			}
			if (next.menuKey !== prev?.menuKey) {
				menu.hidden = next.menuKey === null;
				if (next.menuKey) {
					search.value = "";
					fill();
					place();
					highlight();
					search.focus();
				}
			}
			layout();
		},
		layout,
		flashCopied(key) {
			const bar = bars.get(key);
			if (!bar) return;
			setCopyLabel(bar.copy, true);
			clearTimeout(bar.timer);
			bar.timer = window.setTimeout(() => setCopyLabel(bar.copy, false), 1200);
		},
		ownsPress(node) {
			const button = state.menuKey ? bars.get(state.menuKey)?.lang : undefined;
			return menu.contains(node) || !!button?.contains(node);
		},
		destroy() {
			for (const key of bars.keys()) removeBar(key); // deleting while iterating a Map is safe
			host.removeEventListener("mousedown", onMouseDown);
			host.removeEventListener("click", onClick);
			menu.remove();
		},
	};
}
