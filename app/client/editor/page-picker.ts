import { $isCodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import { icon } from "@modules/icons";
import {
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

import { alertDialog } from "../_dialog";
import { allPages, currentPageId } from "./page-directory";
import { $insertPageLink } from "./page-link-node";

/** `[[` opens the picker; the text typed after it filters the pages. */
const TRIGGER = /\[\[([^[\]\n]{0,60})$/;
const MAX_RESULTS = 8;

type Choice = { kind: "page"; id: string; title: string } | { kind: "new"; title: string };

interface Match {
	key: NodeKey;
	start: number;
	end: number;
	query: string;
}

/** Pages whose title contains `query`, the ones starting with it first. */
export function rankPages<T extends { title: string }>(pages: T[], query: string): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return pages.slice(0, MAX_RESULTS);
	const starts: T[] = [];
	const contains: T[] = [];
	for (const page of pages) {
		const title = page.title.toLowerCase();
		if (title.startsWith(q)) starts.push(page);
		else if (title.includes(q)) contains.push(page);
	}
	return [...starts, ...contains].slice(0, MAX_RESULTS);
}

/**
 * The `[[` page picker: search pages to link to, or create a new one from the
 * typed text. `createPath` is the page action that makes the new page.
 */
export function registerPagePicker(
	editor: LexicalEditor,
	createPath: string | undefined,
): () => void {
	const menu = document.createElement("div");
	menu.className = "slash-menu page-picker";
	menu.setAttribute("role", "listbox");
	menu.setAttribute("aria-label", "Link to page");
	menu.hidden = true;
	menu.addEventListener("mousedown", (event) => event.preventDefault());
	let lastPointer = "";
	menu.addEventListener("pointermove", (event) => {
		const at = `${event.screenX},${event.screenY}`;
		if (at === lastPointer) return;
		lastPointer = at;
		const button = (event.target as Element).closest<HTMLElement>(".slash-item");
		const index = Number(button?.dataset.index ?? -1);
		if (index < 0 || index === active) return;
		active = index;
		highlight();
	});
	menu.addEventListener("click", (event) => {
		const button = (event.target as Element).closest<HTMLElement>(".slash-item");
		const choice = choices[Number(button?.dataset.index ?? -1)];
		if (choice) choose(choice);
	});
	document.body.append(menu);

	let match: Match | null = null;
	let choices: Choice[] = [];
	let active = 0;
	let dismissed: string | null = null;

	const close = () => {
		match = null;
		menu.hidden = true;
	};

	const highlight = () => {
		menu.querySelectorAll<HTMLElement>(".slash-item").forEach((button, index) => {
			button.classList.toggle("is-active", index === active);
			button.setAttribute("aria-selected", String(index === active));
		});
		menu.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
	};

	let renderedKey = "";
	const render = () => {
		const key = JSON.stringify(choices);
		if (key !== renderedKey) {
			renderedKey = key;
			const heading = document.createElement("div");
			heading.className = "page-picker-head";
			heading.textContent = "Link to page";
			menu.replaceChildren(
				heading,
				...choices.map((choice, index) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "slash-item page-pick";
					button.setAttribute("role", "option");
					button.dataset.index = String(index);
					button.innerHTML = icon(choice.kind === "new" ? "filePlus" : "fileText");
					const label = document.createElement("span");
					label.className = "slash-label";
					label.textContent =
						choice.kind === "new"
							? choice.title
								? `New page “${choice.title}”`
								: "New page"
							: choice.title;
					button.append(label);
					return button;
				}),
			);
		}
		highlight();
	};

	const position = () => {
		const range = window.getSelection()?.getRangeAt(0);
		const rect = range?.getBoundingClientRect();
		if (!rect) return;
		const top = rect.bottom + 6;
		const fitsBelow = top + menu.offsetHeight < window.innerHeight;
		menu.style.top = `${fitsBelow ? top : Math.max(8, rect.top - menu.offsetHeight - 6)}px`;
		menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	};

	/** Removes the `[[query` text (if it's still there) and links to `pageId`. */
	const link = (at: Match, pageId: string) => {
		editor.update(() => {
			const node = $getNodeByKey(at.key);
			if ($isTextNode(node) && node.getTextContent().slice(at.start, at.end) === `[[${at.query}`) {
				node.spliceText(at.start, at.end - at.start, "", true);
			}
			$insertPageLink(pageId);
		});
		editor.focus();
	};

	let creating = false;
	const create = async (at: Match, title: string) => {
		if (!createPath || creating) return;
		creating = true;
		try {
			const res = await fetch(location.pathname + createPath, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title }),
			});
			if (!res.ok) throw new Error(`linkPage failed: ${res.status}`);
			const made = (await res.json()) as { id: string; tree: string };
			// Update the sidebar first so the new link can show the page's title.
			document.dispatchEvent(new CustomEvent("cfnotes:tree", { detail: made.tree }));
			link(at, made.id);
		} catch (error) {
			console.warn(error);
			void alertDialog("Couldn't create the page", "Check your connection and try again.");
		} finally {
			creating = false;
		}
	};

	const choose = (choice: Choice) => {
		const at = match;
		close();
		if (!at) return;
		if (choice.kind === "page") link(at, choice.id);
		else void create(at, choice.title);
	};

	const refresh = () => {
		let next: Match | null = null;
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
			const node = selection.anchor.getNode();
			if (!$isTextNode(node) || $isCodeNode(node.getTopLevelElement())) return;
			const found = TRIGGER.exec(node.getTextContent().slice(0, selection.anchor.offset));
			if (!found) return;
			const query = found[1] ?? "";
			next = {
				key: node.getKey(),
				start: selection.anchor.offset - query.length - 2,
				end: selection.anchor.offset,
				query,
			};
		});

		const found = next as Match | null;
		if (!found || dismissed === `${found.key}:${found.start}`) return close();
		dismissed = null;

		const self = currentPageId();
		const pages = rankPages(
			allPages().filter((page) => page.id !== self),
			found.query,
		);
		const title = found.query.replace(/\s+/g, " ").trim();
		const list: Choice[] = pages.map((page) => ({ kind: "page", ...page }));
		if (createPath) list.push({ kind: "new", title });

		if (match?.query !== found.query) active = 0;
		match = found;
		choices = list;
		active = Math.min(active, choices.length - 1);
		menu.hidden = false;
		render();
		position();
	};

	const move = (delta: number) => (event: KeyboardEvent | null) => {
		if (!match || choices.length === 0) return false;
		event?.preventDefault();
		active = (active + delta + choices.length) % choices.length;
		highlight();
		return true;
	};

	const pick = (event: KeyboardEvent | null) => {
		if (!match) return false;
		const choice = choices[active];
		if (!choice) return false;
		event?.preventDefault();
		choose(choice);
		return true;
	};

	const onScroll = () => {
		if (match) position();
	};
	window.addEventListener("scroll", onScroll, true);

	return mergeRegister(
		editor.registerUpdateListener(refresh),
		editor.registerCommand(KEY_ARROW_DOWN_COMMAND, move(1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ARROW_UP_COMMAND, move(-1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			(event) => {
				if (!match) return false;
				event?.preventDefault();
				dismissed = `${match.key}:${match.start}`;
				close();
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		),
		() => {
			window.removeEventListener("scroll", onScroll, true);
			menu.remove();
		},
	);
}
