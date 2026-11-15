import { $isCodeNode, CodeNode } from "@lexical/code";
import { icon } from "@modules/icons";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";

import { languageName, languageOptions, resolveLanguage, PLAIN_TEXT } from "./code-languages";
import {
	$chooseMermaidView,
	$getMermaidView,
	$isMermaidBlock,
	type MermaidView,
} from "./mermaid-preview";

const VIEW_LABELS: [MermaidView, string][] = [
	["code", "Code"],
	["preview", "Preview"],
	["split", "Split"],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
	const node = document.createElement(tag);
	node.className = className;
	if (text) node.textContent = text;
	return node;
}

function setCopyLabel(button: HTMLButtonElement, copied: boolean) {
	button.innerHTML = `${icon(copied ? "check" : "copy", 14)}<span>${copied ? "Copied" : "Copy"}</span>`;
}

interface Bar {
	root: HTMLDivElement;
	lang: HTMLButtonElement;
	/** Code / Preview / Split, on Mermaid blocks only. */
	views: HTMLDivElement;
	copy: HTMLButtonElement;
	timer: number;
}

/**
 * A language picker and Copy button on every code block, and on Mermaid blocks
 * a Code / Preview / Split switch for the diagram. `host` must be
 * positioned; the bars live outside the contenteditable so Lexical never sees them.
 */
export function registerCodeToolbar(editor: LexicalEditor, host: HTMLElement): () => void {
	const bars = new Map<NodeKey, Bar>();

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

	let menuKey: NodeKey | null = null;

	const currentLanguage = (key: NodeKey) =>
		editor.read(() => {
			const node = $getNodeByKey(key);
			return $isCodeNode(node) ? node.getLanguage() : undefined;
		});

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
		if (menuKey === key) closeMenu(false);
	};

	/** Puts each bar over the top padding of its code block and refreshes its label. */
	const layout = () => {
		const outer = host.getBoundingClientRect();
		for (const [key, bar] of bars) {
			const dom = editor.getElementByKey(key);
			bar.root.hidden = !dom;
			if (!dom) continue;
			const name = languageName(currentLanguage(key));
			const label = bar.lang.firstElementChild!;
			if (label.textContent !== name) label.textContent = name;
			const view = editor.read(() => {
				const node = $getNodeByKey(key);
				return $isMermaidBlock(node) ? $getMermaidView(node) : null;
			});
			bar.views.hidden = view === null;
			for (const button of bar.views.children as HTMLCollectionOf<HTMLElement>) {
				const on = button.dataset.view === view;
				button.classList.toggle("is-active", on);
				button.setAttribute("aria-pressed", String(on));
			}
			const rect = dom.getBoundingClientRect();
			bar.root.style.top = `${rect.top - outer.top + 6}px`;
			bar.root.style.left = `${rect.left - outer.left + 8}px`;
			bar.root.style.width = `${rect.width - 16}px`;
		}
	};

	const offMutations = editor.registerMutationListener(
		CodeNode,
		(mutations) => {
			for (const [key, mutation] of mutations) {
				if (mutation === "destroyed") removeBar(key);
				else if (!bars.has(key)) bars.set(key, createBar(key));
			}
			layout();
		},
		{ skipInitialization: false },
	);

	const barKey = (target: EventTarget | null) =>
		(target as Element | null)?.closest<HTMLElement>(".code-bar")?.dataset.key ?? null;

	// Keep the editor's focus and selection when pressing a bar's buttons.
	const onMouseDown = (event: MouseEvent) => {
		if (barKey(event.target)) event.preventDefault();
	};

	const copy = (key: NodeKey) => {
		const bar = bars.get(key);
		if (!bar) return;
		const text = editor.read(() => $getNodeByKey(key)?.getTextContent() ?? "");
		void navigator.clipboard.writeText(text).then(() => {
			setCopyLabel(bar.copy, true);
			clearTimeout(bar.timer);
			bar.timer = window.setTimeout(() => setCopyLabel(bar.copy, false), 1200);
		});
	};

	const onClick = (event: MouseEvent) => {
		const key = barKey(event.target);
		const button = (event.target as Element).closest("button");
		if (!key || !button) return;
		const view = button.dataset.view as MermaidView | undefined;
		if (view) editor.update(() => $chooseMermaidView(key, view));
		else if (button.classList.contains("code-copy")) copy(key);
		else if (menuKey === key) closeMenu(true);
		else openMenu(key);
	};
	host.addEventListener("mousedown", onMouseDown);
	host.addEventListener("click", onClick);

	// ---- language menu ----
	let shown = languageOptions();
	let active = 0;

	const highlight = () => {
		list.querySelectorAll<HTMLElement>(".lang-item").forEach((item, index) => {
			item.classList.toggle("is-active", index === active);
			item.setAttribute("aria-selected", String(index === active));
		});
		list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
	};

	const fill = () => {
		const q = search.value.trim().toLowerCase();
		const all = languageOptions();
		shown = q
			? all
					.filter(
						(o) =>
							o.name.toLowerCase().includes(q) ||
							o.id.includes(q) ||
							o.aliases.some((alias) => alias.includes(q)),
					)
					// Prefix matches first, keeping the picker's order otherwise.
					.sort(
						(a, b) =>
							Number(!a.name.toLowerCase().startsWith(q)) -
							Number(!b.name.toLowerCase().startsWith(q)),
					)
			: all;
		const current = menuKey ? (resolveLanguage(currentLanguage(menuKey)) ?? PLAIN_TEXT) : "";
		active = q
			? 0
			: Math.max(
					0,
					shown.findIndex((o) => o.id === current),
				);
		list.replaceChildren(
			...shown.map((option, index) => {
				const item = el("button", "lang-item");
				item.type = "button";
				item.setAttribute("role", "option");
				item.dataset.index = String(index);
				item.append(el("span", "lang-name", option.name));
				if (option.id === current) {
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
		const button = menuKey ? bars.get(menuKey)?.lang : undefined;
		if (!button) return;
		const rect = button.getBoundingClientRect();
		const below = rect.bottom + 4;
		const fits = below + menu.offsetHeight < window.innerHeight - 8;
		menu.style.top = `${fits ? below : Math.max(8, rect.top - menu.offsetHeight - 4)}px`;
		menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
	};

	const openMenu = (key: NodeKey) => {
		menuKey = key;
		search.value = "";
		menu.hidden = false;
		fill();
		place();
		highlight();
		search.focus();
	};

	const closeMenu = (refocus: boolean) => {
		if (menu.hidden) return;
		menu.hidden = true;
		menuKey = null;
		if (refocus) editor.focus();
	};

	const choose = (index: number) => {
		const option = shown[index];
		const key = menuKey;
		if (!option || !key) return;
		editor.update(() => {
			const node = $getNodeByKey(key);
			if ($isCodeNode(node)) node.setLanguage(option.id);
		});
		closeMenu(true);
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
			closeMenu(true);
		} else if (event.key === "Tab") {
			closeMenu(false);
		}
	});
	// Same rule as the slash menu: only real pointer movement moves the highlight,
	// not items scrolling under a resting pointer.
	let lastPointer = "";
	list.addEventListener("pointermove", (event) => {
		const at = `${event.screenX},${event.screenY}`;
		if (at === lastPointer) return;
		lastPointer = at;
		const item = (event.target as Element).closest<HTMLElement>(".lang-item");
		const index = Number(item?.dataset.index ?? -1);
		if (index < 0 || index === active) return;
		active = index;
		highlight();
	});
	list.addEventListener("mousedown", (event) => event.preventDefault());
	list.addEventListener("click", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".lang-item");
		if (item) choose(Number(item.dataset.index));
	});

	const onOutside = (event: PointerEvent) => {
		const node = event.target as Node;
		const button = menuKey ? bars.get(menuKey)?.lang : undefined;
		if (!menu.hidden && !menu.contains(node) && !button?.contains(node)) closeMenu(false);
	};
	const onResize = () => {
		layout();
		if (!menu.hidden) place();
	};
	document.addEventListener("pointerdown", onOutside, true);
	window.addEventListener("resize", onResize);
	window.addEventListener("scroll", onResize, true);

	// Edits anywhere can move a block (and change its label), so lay out after each one.
	const offUpdate = editor.registerUpdateListener(layout);
	const resizes = new ResizeObserver(layout);
	resizes.observe(host);

	return () => {
		offUpdate();
		offMutations();
		resizes.disconnect();
		for (const key of bars.keys()) removeBar(key); // deleting while iterating a Map is safe
		host.removeEventListener("mousedown", onMouseDown);
		host.removeEventListener("click", onClick);
		document.removeEventListener("pointerdown", onOutside, true);
		window.removeEventListener("resize", onResize);
		window.removeEventListener("scroll", onResize, true);
		menu.remove();
	};
}
