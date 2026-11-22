/**
 * Sidebar folders: open/close, inline create and rename, the ⋯ menus, the
 * "Move to" picker and drag and drop. Every change is one POST to a page
 * action, which answers with the re-rendered tree; we swap it into `#page-nav`.
 */

import { icon } from "#lib/icons.ts";
import { alertDialog } from "#lib/ui/dialog.ts";
import { toast, toastNextPage } from "#lib/ui/toast.ts";
import { type FolderUndo, archivedToast, folderToast } from "#modules/trash/client/undo.ts";

const OPEN_KEY = "cfnotes:open-folders";

type Kind = "page" | "folder";

interface MenuItem {
	label: string;
	run: () => void;
	danger?: boolean;
	disabled?: boolean;
	checked?: boolean;
	depth?: number;
}

function init() {
	const nav = document.querySelector<HTMLElement>("#page-nav");
	const side = nav?.closest<HTMLElement>(".sidebar");
	if (!nav || !side) return;
	const paths = JSON.parse(nav.dataset.actions ?? "{}") as Record<string, string>;

	// ---------- open folders ----------

	const readOpen = (): Set<string> => {
		try {
			return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as string[]);
		} catch {
			return new Set();
		}
	};
	const saveOpen = () => {
		const ids = [...nav.querySelectorAll<HTMLElement>(".tree-folder.is-open")].map(
			(f) => f.dataset.folder!,
		);
		try {
			localStorage.setItem(OPEN_KEY, JSON.stringify(ids));
		} catch {}
	};
	const setFolderOpen = (folder: HTMLElement, open: boolean) => {
		folder.classList.toggle("is-open", open);
		folder.querySelector(".folder-toggle")?.setAttribute("aria-expanded", String(open));
	};
	// Folders opened by the server (they hold the current page) count as open from now on.
	saveOpen();

	const folderEl = (id: string | null) =>
		id ? nav.querySelector<HTMLElement>(`.tree-folder[data-folder="${CSS.escape(id)}"]`) : null;
	const folderName = (id: string) =>
		folderEl(id)?.querySelector(".folder-name")?.textContent?.trim() ?? "";
	/** The folder an item sits in (`null` = top level). */
	const homeOf = (el: Element): string | null =>
		el.parentElement?.closest<HTMLElement>(".tree-folder")?.dataset.folder ?? null;

	// ---------- server round trips ----------

	/** Puts freshly rendered tree markup into `#page-nav`, keeping open folders and scroll. */
	function swapTree(markup: string, openIds: string[] = []) {
		const open = readOpen();
		for (const id of openIds) open.add(id);
		const scroll = nav!.scrollTop;
		const template = document.createElement("template");
		template.innerHTML = markup;
		nav!.replaceChildren(template.content);
		// The stored list decides; the server only opens folders on a fresh page load.
		for (const folder of nav!.querySelectorAll<HTMLElement>(".tree-folder")) {
			setFolderOpen(folder, open.has(folder.dataset.folder!));
		}
		saveOpen();
		nav!.scrollTop = scroll;
	}
	// The editor's page picker creates pages too and hands us the new tree.
	document.addEventListener("cfnotes:tree", (e) => {
		const markup = (e as CustomEvent<unknown>).detail;
		if (typeof markup === "string") swapTree(markup);
	});

	let busy = false;
	/** Posts a sidebar action and swaps in the tree it answers with; resolves `true` on success. */
	async function act(
		name: string,
		body: Record<string, unknown>,
		openIds: string[] = [],
	): Promise<Response | null> {
		const path = paths[name];
		if (!path || busy) return null;
		busy = true;
		try {
			const res = await fetch(location.pathname + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
			swapTree(await res.text(), openIds);
			return res;
		} catch (error) {
			console.warn(error);
			void alertDialog("That didn't save", "Check your connection and try again.");
			return null;
		} finally {
			busy = false;
		}
	}

	// ---------- inline name input (new folder, rename) ----------

	function nameInput(initial: string, commit: (name: string) => void, cancel: () => void) {
		const input = document.createElement("input");
		input.className = "folder-input";
		input.value = initial;
		input.maxLength = 100;
		input.setAttribute("aria-label", "Folder name");
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			const name = input.value.trim();
			if (save && name && name !== initial) commit(name);
			else cancel();
		};
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(true));
		// Clicks inside shouldn't toggle the folder or start a drag.
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("pointerdown", (e) => e.stopPropagation());
		return input;
	}

	function newFolder(parentId: string | null) {
		const parent = folderEl(parentId);
		const box = parent ? parent.querySelector<HTMLElement>(":scope > .folder-children")! : nav!;
		if (parent) setFolderOpen(parent, true);
		const row = document.createElement("div");
		row.className = "tree-row folder-row is-draft";
		const remove = () => row.remove();
		const input = nameInput(
			"",
			(name) => {
				row.remove();
				void act("newFolder", { name, parentId }, parentId ? [parentId] : []);
			},
			remove,
		);
		input.placeholder = "Folder name";
		const badge = document.createElement("span");
		badge.className = "folder-icon";
		badge.innerHTML = icon("folder");
		row.append(badge, input);
		box.prepend(row);
		row.scrollIntoView({ block: "nearest" });
		input.focus();
	}

	function rename(id: string) {
		const label = folderEl(id)?.querySelector<HTMLElement>(":scope > .folder-row .folder-name");
		if (!label) return;
		const old = label.textContent?.trim() ?? "";
		const row = label.closest<HTMLElement>(".folder-row")!;
		row.draggable = false;
		const input = nameInput(
			old,
			(name) => {
				label.textContent = name;
				input.replaceWith(label);
				void act("renameFolder", { id, name });
			},
			() => {
				input.replaceWith(label);
				row.draggable = true;
			},
		);
		label.replaceWith(input);
		input.focus();
		input.select();
	}

	// No question: its pages and subfolders move up a level, and the toast offers Undo.
	async function deleteFolder(id: string) {
		const name = folderName(id);
		const parentId = homeOf(folderEl(id)!);
		const res = await act("deleteFolder", { id }, parentId ? [parentId] : []);
		if (!res) return;
		const undo = JSON.parse(
			decodeURIComponent(res.headers.get("x-undo") ?? "null"),
		) as FolderUndo | null;
		if (undo) folderToast(name, undo);
		else toast({ title: `Deleted the folder “${name}”` });
	}

	function move(kind: Kind, id: string, folderId: string | null) {
		void act("move", { kind, id, folderId }, folderId ? [folderId] : []);
	}

	// ---------- menu (shared by folder options and the move picker) ----------

	const menu = document.createElement("div");
	menu.className = "side-menu";
	menu.setAttribute("role", "menu");
	menu.hidden = true;
	// Inside the sidebar so hovering the menu keeps a peeking sidebar open.
	side.append(menu);
	let items: MenuItem[] = [];
	let active = -1;
	let anchor: HTMLElement | null = null;
	let last = { x: -1, y: -1 };

	const enabled = () => items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
	const highlight = (index: number) => {
		active = index;
		menu.querySelectorAll<HTMLElement>(".side-menu-item").forEach((el) => {
			const on = Number(el.dataset.index) === index;
			el.classList.toggle("is-active", on);
			if (on) el.scrollIntoView({ block: "nearest" });
		});
	};

	function openMenu(at: HTMLElement | { x: number; y: number }, title: string, list: MenuItem[]) {
		items = list;
		anchor = at instanceof HTMLElement ? at : null;
		menu.replaceChildren();
		const heading = document.createElement("div");
		heading.className = "side-menu-title";
		heading.textContent = title;
		menu.append(heading);
		list.forEach((item, i) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "side-menu-item";
			button.dataset.index = String(i);
			button.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemradio");
			if (item.checked !== undefined) button.setAttribute("aria-checked", String(item.checked));
			button.disabled = !!item.disabled;
			button.classList.toggle("is-danger", !!item.danger);
			button.style.setProperty("--depth", String(item.depth ?? 0));
			const label = document.createElement("span");
			label.textContent = item.label;
			button.append(label);
			if (item.checked) {
				const mark = document.createElement("span");
				mark.className = "side-menu-check";
				mark.innerHTML = icon("check", 14);
				button.append(mark);
			}
			menu.append(button);
		});
		menu.hidden = false;
		active = -1;
		// Place under the anchor (or at the pointer), kept on screen.
		const r = anchor
			? anchor.getBoundingClientRect()
			: new DOMRect((at as { x: number }).x, (at as { y: number }).y, 0, 0);
		const w = menu.offsetWidth;
		const h = menu.offsetHeight;
		let left = anchor ? r.left : r.left;
		let top = r.bottom + 4;
		if (left + w > innerWidth - 8) left = innerWidth - w - 8;
		if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
		menu.style.left = `${Math.max(8, left)}px`;
		menu.style.top = `${top}px`;
		anchor?.classList.add("is-open");
	}

	function closeMenu() {
		if (menu.hidden) return;
		menu.hidden = true;
		anchor?.classList.remove("is-open");
		anchor = null;
	}

	function choose(index: number) {
		const item = items[index];
		if (!item || item.disabled) return;
		closeMenu();
		item.run();
	}

	menu.addEventListener("click", (e) => {
		const el = (e.target as Element).closest<HTMLElement>(".side-menu-item");
		if (el) choose(Number(el.dataset.index));
	});
	// Hover follows the pointer only when it really moves (not when the list scrolls under it).
	menu.addEventListener("pointermove", (e) => {
		if (e.screenX === last.x && e.screenY === last.y) return;
		last = { x: e.screenX, y: e.screenY };
		const el = (e.target as Element).closest<HTMLElement>(".side-menu-item");
		if (el && !(el as HTMLButtonElement).disabled) highlight(Number(el.dataset.index));
	});
	document.addEventListener(
		"keydown",
		(e) => {
			if (menu.hidden) return;
			const order = enabled();
			const at = order.indexOf(active);
			if (e.key === "ArrowDown") highlight(order[(at + 1) % order.length] ?? -1);
			else if (e.key === "ArrowUp") highlight(order[at <= 0 ? order.length - 1 : at - 1] ?? -1);
			else if (e.key === "Enter" && active >= 0) choose(active);
			else if (e.key === "Escape" || e.key === "Tab") closeMenu();
			else return;
			e.preventDefault();
			e.stopPropagation();
		},
		true,
	);
	document.addEventListener("pointerdown", (e) => {
		const target = e.target as Element;
		if (!menu.contains(target) && !target.closest?.(".folder-more, .page-more")) closeMenu();
	});
	nav.addEventListener("scroll", closeMenu);
	addEventListener("resize", closeMenu);

	/** Every folder as an indented list, for the move picker. */
	function folderChoices(kind: Kind, id: string): MenuItem[] {
		const current =
			kind === "page"
				? homeOf(nav!.querySelector(`.tree-page[data-page="${CSS.escape(id)}"]`)!)
				: homeOf(folderEl(id)!);
		const self = kind === "folder" ? folderEl(id) : null;
		const list: MenuItem[] = [
			{
				label: "Top level",
				checked: current === null,
				disabled: current === null,
				run: () => move(kind, id, null),
			},
		];
		const walk = (box: Element, depth: number) => {
			for (const folder of box.querySelectorAll<HTMLElement>(":scope > .tree-folder")) {
				const fid = folder.dataset.folder!;
				// A folder can't go into itself or anything inside it.
				if (self && (folder === self || self.contains(folder))) continue;
				list.push({
					label: folderName(fid),
					depth,
					checked: current === fid,
					disabled: current === fid,
					run: () => move(kind, id, fid),
				});
				walk(folder.querySelector(":scope > .folder-children")!, depth + 1);
			}
		};
		walk(nav!, 1);
		return list;
	}

	function folderMenu(id: string, at: HTMLElement | { x: number; y: number }) {
		openMenu(at, folderName(id), [
			{
				label: "New page",
				run: () => {
					const form = document.querySelector<HTMLFormElement>("#new-page-form");
					const button = folderEl(id)?.querySelector<HTMLButtonElement>(
						':scope > .folder-row button[name="folder"]',
					);
					if (form && button) form.requestSubmit(button);
				},
			},
			{
				label: "New database",
				run: () => {
					const form = document.querySelector<HTMLFormElement>("#new-db-form");
					if (!form) return;
					const field = document.createElement("input");
					field.type = "hidden";
					field.name = "folder";
					field.value = id;
					form.append(field);
					form.submit();
				},
			},
			{ label: "New folder", run: () => newFolder(id) },
			{ label: "Rename", run: () => rename(id) },
			{ label: "Move to…", run: () => openMenu(at, "Move to", folderChoices("folder", id)) },
			{ label: "Delete", danger: true, run: () => void deleteFolder(id) },
		]);
	}

	async function deletePage(id: string) {
		const link = nav!.querySelector(`#nav-${CSS.escape(id)}`);
		const title = link?.querySelector(".nav-label")?.textContent?.trim() || "Untitled";
		// No question: it goes to Trash, and the toast offers Undo.
		const current = location.pathname === `/p/${id}`;
		void act("removePage", { id }).then((ok) => {
			if (!ok) return;
			// The open page is gone: go to the workspace, which opens another one,
			// and say so there. Undo brings it back and reopens it.
			if (current) {
				toastNextPage({ title, undoArchive: { id, reopen: true } });
				location.href = "/";
			} else archivedToast({ id, title });
		});
	}

	function pageMenu(id: string, at: HTMLElement | { x: number; y: number }) {
		const title =
			nav!.querySelector(`#nav-${CSS.escape(id)} .nav-label`)?.textContent?.trim() || "Untitled";
		openMenu(at, title, [
			{ label: "Move to…", run: () => openMenu(at, "Move to", folderChoices("page", id)) },
			{ label: "Delete", danger: true, run: () => void deletePage(id) },
		]);
	}

	// ---------- clicks ----------

	side.querySelector(".new-folder")?.addEventListener("click", () => newFolder(null));

	nav.addEventListener("click", (e) => {
		const target = e.target as Element;
		const more = target.closest<HTMLElement>(".folder-more, .page-more");
		if (more) {
			e.preventDefault();
			if (anchor === more) return closeMenu();
			const page = more.closest<HTMLElement>(".tree-page");
			if (page) pageMenu(page.dataset.page!, more);
			else folderMenu(more.closest<HTMLElement>(".tree-folder")!.dataset.folder!, more);
			return;
		}
		const row = target.closest<HTMLElement>(".folder-row:not(.is-draft)");
		// The whole row toggles, except its "+" button (that submits the new-page form).
		if (row && !target.closest(".row-btn")) {
			const folder = row.closest<HTMLElement>(".tree-folder")!;
			setFolderOpen(folder, !folder.classList.contains("is-open"));
			saveOpen();
		}
	});

	nav.addEventListener("contextmenu", (e) => {
		const target = e.target as Element;
		const page = target.closest<HTMLElement>(".tree-page");
		const row = target.closest<HTMLElement>(".folder-row:not(.is-draft)");
		if (!page && !row) return;
		e.preventDefault();
		const at = { x: e.clientX, y: e.clientY };
		if (page) pageMenu(page.dataset.page!, at);
		else folderMenu(row!.closest<HTMLElement>(".tree-folder")!.dataset.folder!, at);
	});

	nav.addEventListener("dblclick", (e) => {
		const name = (e.target as Element).closest(".folder-name");
		if (name) rename(name.closest<HTMLElement>(".tree-folder")!.dataset.folder!);
	});

	// ---------- drag and drop ----------

	type Drop =
		| { type: "folder"; folderId: string | null } // into a folder (or top level), at the end
		| { type: "place"; folderId: string | null; beforeId: string | null }; // at an exact spot

	let dragging: { kind: Kind; id: string; el: HTMLElement; from: string | null } | null = null;
	let drop: Drop | null = null;
	let hoverTimer = 0;
	let hoverFolder: HTMLElement | null = null;

	/** The id of the page right after `el` in the same list, if any. */
	const nextPageId = (el: Element): string | null => {
		const next = el.nextElementSibling;
		return next?.matches(".tree-page") ? (next as HTMLElement).dataset.page! : null;
	};

	const clearDrop = () => {
		nav!.classList.remove("is-drop-root");
		nav!
			.querySelectorAll(".is-drop, .drop-before, .drop-after")
			.forEach((el) => el.classList.remove("is-drop", "drop-before", "drop-after"));
	};

	/** Where a drop at this point would go, or `null` if nowhere valid. */
	function dropAt(target: Element, clientY: number): { drop: Drop; mark: () => void } | null {
		const d = dragging!;
		const row = target.closest<HTMLElement>(".folder-row:not(.is-draft)");
		const folder = row?.closest<HTMLElement>(".tree-folder") ?? null;

		// Over a folder row: into that folder. Not a folder into itself or its subfolders.
		if (folder) {
			if (d.kind === "folder" && (folder === d.el || d.el.contains(folder))) return null;
			const folderId = folder.dataset.folder!;
			if (folderId === d.from) return null;
			return { drop: { type: "folder", folderId }, mark: () => row!.classList.add("is-drop") };
		}

		// A page over another page: before or after it, whichever half the pointer is in.
		const over = target.closest<HTMLElement>(".tree-page");
		if (d.kind === "page" && over && over !== d.el) {
			const rect = over.getBoundingClientRect();
			const before = clientY < rect.top + rect.height / 2;
			const folderId = homeOf(over);
			const beforeId = before ? over.dataset.page! : nextPageId(over);
			// Dropping right where it already is changes nothing.
			if (folderId === d.from && (beforeId === d.id || beforeId === nextPageId(d.el))) return null;
			return {
				drop: { type: "place", folderId, beforeId },
				mark: () => over.classList.add(before ? "drop-before" : "drop-after"),
			};
		}

		// Anywhere else: the folder around that spot, else top level.
		const item = target.closest<HTMLElement>(".tree-page, .folder-children");
		const folderId = item
			? (item.closest<HTMLElement>(".tree-folder")?.dataset.folder ?? null)
			: null;
		if (d.kind === "folder" && folderId && d.el.contains(folderEl(folderId))) return null;
		if (folderId === d.from) return null;
		return {
			drop: { type: "folder", folderId },
			mark: () =>
				folderId === null
					? nav!.classList.add("is-drop-root")
					: folderEl(folderId)?.querySelector(":scope > .folder-row")?.classList.add("is-drop"),
		};
	}

	nav.addEventListener("dragstart", (e) => {
		const target = e.target as Element;
		const page = target.closest<HTMLElement>(".tree-page");
		const row = target.closest<HTMLElement>(".folder-row:not(.is-draft)");
		if (!page && !row) return;
		closeMenu();
		const el = page ?? row!.closest<HTMLElement>(".tree-folder")!;
		const kind: Kind = page ? "page" : "folder";
		const id = page ? page.dataset.page! : el.dataset.folder!;
		dragging = { kind, id, el, from: homeOf(el) };
		e.dataTransfer!.effectAllowed = "move";
		e.dataTransfer!.setData("text/plain", page ? page.querySelector("a")!.href : folderName(id));
		requestAnimationFrame(() => el.classList.add("is-dragging"));
	});

	nav.addEventListener("dragover", (e) => {
		if (!dragging) return;
		const target = e.target as Element;

		// Hovering a closed folder for a moment opens it.
		const folder =
			target
				.closest<HTMLElement>(".folder-row:not(.is-draft)")
				?.closest<HTMLElement>(".tree-folder") ?? null;
		if (folder !== hoverFolder) {
			clearTimeout(hoverTimer);
			hoverFolder = folder;
			const blocked = dragging.kind === "folder" && folder && dragging.el.contains(folder);
			if (folder && !folder.classList.contains("is-open") && !blocked) {
				hoverTimer = window.setTimeout(() => {
					setFolderOpen(folder, true);
					saveOpen();
				}, 600);
			}
		}

		const found = dropAt(target, e.clientY);
		drop = found?.drop ?? null;
		clearDrop();
		if (!found) {
			e.dataTransfer!.dropEffect = "none";
			return;
		}
		e.preventDefault();
		e.dataTransfer!.dropEffect = "move";
		found.mark();
	});

	nav.addEventListener("dragleave", (e) => {
		if (!nav!.contains(e.relatedTarget as Node)) {
			clearDrop();
			drop = null;
		}
	});

	nav.addEventListener("drop", (e) => {
		if (!dragging || !drop) return;
		e.preventDefault();
		const { folderId } = drop;
		if (drop.type === "place") {
			void act(
				"reorder",
				{ id: dragging.id, folderId, beforeId: drop.beforeId },
				folderId ? [folderId] : [],
			);
		} else {
			move(dragging.kind, dragging.id, folderId);
		}
	});

	nav.addEventListener("dragend", () => {
		dragging?.el.classList.remove("is-dragging");
		dragging = null;
		drop = null;
		hoverFolder = null;
		clearTimeout(hoverTimer);
		clearDrop();
	});
}

init();
