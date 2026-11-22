import { icon } from "#lib/icons.ts";

/**
 * Quick-find (⌘P / Ctrl+P, or the sidebar's Search button): a dialog that
 * searches page titles and contents as you type. ↑/↓ choose, Enter opens,
 * ⌘/Ctrl+Enter opens in a new tab, Escape closes. On the Trash page it
 * searches only what's in Trash.
 */

interface Result {
	id: string;
	title: string;
	kind: string;
	icon: string | null;
	parent: string | null;
	snippet: string;
	href: string;
}

const inTrash = location.pathname === "/trash";
const noun = inTrash ? "Trash" : "pages";

const dialog = document.createElement("dialog");
dialog.className = "qf";
dialog.setAttribute("aria-label", "Search");
dialog.innerHTML = `<div class="qf-box">
	<div class="qf-bar">${icon("search", 18)}<input class="qf-input" type="search" placeholder="Search ${noun}…" aria-label="Search ${noun}" autocomplete="off" spellcheck="false" /></div>
	<div class="qf-list" role="listbox"></div>
	<div class="qf-foot"><span>↑↓ Select</span><span>↵ Open</span><span>⌘↵ New tab</span><span>esc Close</span></div>
</div>`;
document.body.append(dialog);

const input = dialog.querySelector<HTMLInputElement>(".qf-input") as HTMLInputElement;
const list = dialog.querySelector<HTMLElement>(".qf-list") as HTMLElement;

let results: Result[] = [];
let active = 0;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** `text` with each query term wrapped in <mark>, built from text nodes (never HTML). */
function highlighted(text: string, terms: string[]): DocumentFragment {
	const fragment = document.createDocumentFragment();
	const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
	if (escaped.length === 0) {
		fragment.append(text);
		return fragment;
	}
	const re = new RegExp(`(${escaped.join("|")})`, "gi");
	let last = 0;
	for (const match of text.matchAll(re)) {
		const at = match.index ?? 0;
		if (at > last) fragment.append(text.slice(last, at));
		const mark = document.createElement("mark");
		mark.textContent = match[0];
		fragment.append(mark);
		last = at + match[0].length;
	}
	if (last < text.length) fragment.append(text.slice(last));
	return fragment;
}

function render(query: string): void {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	list.replaceChildren();
	if (results.length === 0) {
		const empty = document.createElement("div");
		empty.className = "qf-empty";
		empty.textContent = query.trim() ? "No results" : inTrash ? "Trash is empty" : "No pages yet";
		list.append(empty);
		return;
	}
	if (!query.trim()) {
		const head = document.createElement("div");
		head.className = "qf-head";
		head.textContent = inTrash ? "Recently deleted" : "Recent";
		list.append(head);
	}
	results.forEach((result, index) => {
		const item = document.createElement("a");
		item.className = "qf-item";
		item.href = result.href;
		item.setAttribute("role", "option");
		item.dataset.index = String(index);

		const mark = document.createElement("span");
		mark.className = "qf-icon";
		if (result.icon) mark.textContent = result.icon;
		else mark.innerHTML = icon(result.kind === "database" ? "table" : "fileText", 18);

		const text = document.createElement("span");
		text.className = "qf-text";
		const title = document.createElement("span");
		title.className = "qf-title";
		title.append(highlighted(result.title.trim() || "Untitled", terms));
		text.append(title);
		if (result.parent !== null) {
			const parent = document.createElement("span");
			parent.className = "qf-parent";
			parent.textContent = `in ${result.parent.trim() || "Untitled"}`;
			title.append(" ", parent);
		}
		if (result.snippet) {
			const snippet = document.createElement("span");
			snippet.className = "qf-snippet";
			snippet.append(highlighted(result.snippet, terms));
			text.append(snippet);
		}
		item.append(mark, text);
		list.append(item);
	});
	highlight();
}

function highlight(): void {
	for (const item of list.querySelectorAll<HTMLElement>(".qf-item")) {
		const on = Number(item.dataset.index) === active;
		item.classList.toggle("is-active", on);
		item.setAttribute("aria-selected", String(on));
		if (on) item.scrollIntoView({ block: "nearest" });
	}
}

async function search(query: string): Promise<void> {
	const mine = ++seq;
	try {
		const res = await fetch(`/search?q=${encodeURIComponent(query)}${inTrash ? "&in=trash" : ""}`);
		if (!res.ok) throw new Error(`search failed: ${res.status}`);
		const data = (await res.json()) as { results: Result[] };
		if (mine !== seq) return; // a newer query is in flight
		results = data.results;
		active = 0;
		render(query);
	} catch (error) {
		console.warn("[search]", error);
	}
}

function open(): void {
	if (dialog.open) {
		input.select();
		return;
	}
	input.value = "";
	results = [];
	list.replaceChildren();
	dialog.showModal();
	input.focus();
	void search("");
}

function go(index: number, newTab: boolean): void {
	const result = results[index];
	if (!result) return;
	if (newTab) window.open(result.href, "_blank", "noopener");
	else location.href = result.href;
	dialog.close();
}

input.addEventListener("input", () => {
	clearTimeout(timer);
	timer = setTimeout(() => void search(input.value), 120);
});

input.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown" || event.key === "ArrowUp") {
		event.preventDefault();
		if (results.length === 0) return;
		active = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
		highlight();
	} else if (event.key === "Escape") {
		// A search input's own Escape only clears it; close in one press instead.
		event.preventDefault();
		dialog.close();
	} else if (event.key === "Enter") {
		event.preventDefault();
		go(active, event.metaKey || event.ctrlKey);
	}
});

list.addEventListener("pointermove", (event) => {
	const item = (event.target as Element).closest<HTMLElement>(".qf-item");
	if (!item) return;
	const index = Number(item.dataset.index);
	if (index !== active) {
		active = index;
		highlight();
	}
});

// Clicking the backdrop (the dialog itself, outside its box) closes it.
dialog.addEventListener("click", (event) => {
	if (event.target === dialog) dialog.close();
});

document.addEventListener("keydown", (event) => {
	if (
		(event.metaKey || event.ctrlKey) &&
		!event.altKey &&
		!event.shiftKey &&
		event.code === "KeyP"
	) {
		event.preventDefault(); // not the print dialog
		open();
	}
});

for (const button of document.querySelectorAll(".side-search"))
	button.addEventListener("click", open);
