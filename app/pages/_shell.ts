import { icon, type IconName } from "@modules/icons";
import {
	buildTree,
	folderPath,
	type FolderNode,
	type FolderRow,
	type PageRow,
} from "@modules/tree";
import { script, styles } from "@space/client";
import { html, raw } from "spacefn/pages";

type Markup = ReturnType<typeof html>;

const FAVICON =
	"data:image/svg+xml," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#37352f"/><path d="M10 9h9l4 4v10H10z" fill="#fff"/></svg>',
	);

/** A Tabler icon as markup (see `modules/icons.ts`). */
const svg = (name: IconName, size?: number) => raw(icon(name, size));

export interface NavPage {
	id: string;
	title: string;
	kind?: string;
	icon?: string | null;
}

export function pageLabel(title: string): string {
	return title.trim() || "Untitled";
}

/**
 * Sidebar link: the page's emoji, or the icon for its kind (page or database),
 * then its title. Its id lets actions patch it after a rename.
 */
export function navLink(page: NavPage, activeId?: string): Markup {
	return html`<a
		id="nav-${page.id}"
		class="nav-link${page.id === activeId ? " is-active" : ""}"
		href="/p/${page.id}"
		data-kind="${page.kind === "database" ? "database" : "page"}"
		><span class="nav-icon"
			>${
				page.icon
					? html`<span class="nav-emoji">${page.icon}</span>`
					: svg(page.kind === "database" ? "table" : "fileText", 16)
			}</span
		><span class="nav-label">${pageLabel(page.title)}</span></a
	>`;
}

function pageItem(page: PageRow, activeId?: string): Markup {
	return html`<div class="tree-page" data-page="${page.id}" draggable="true">
		${navLink(page, activeId)}
		<button class="row-btn page-more" type="button" aria-label="Page options" title="More">
			${svg("dots")}
		</button>
	</div>`;
}

function folderItem(node: FolderNode, open: Set<string>, activeId?: string): Markup {
	const { id, name } = node.folder;
	const isOpen = open.has(id);
	const empty = node.folders.length === 0 && node.pages.length === 0;
	return html`<div class="tree-folder${isOpen ? " is-open" : ""}" data-folder="${id}">
		<div class="tree-row folder-row" draggable="true">
			<button
				class="folder-toggle"
				type="button"
				aria-expanded="${String(isOpen)}"
				aria-label="Toggle ${name}"
			>
				${svg("chevronRight", 14)}
			</button>
			<span class="folder-icon">${svg("folder")}${svg("folderOpen")}</span>
			<span class="folder-name">${name}</span>
			<span class="row-actions">
				<button
					class="row-btn"
					type="submit"
					form="new-page-form"
					name="folder"
					value="${id}"
					aria-label="New page in ${name}"
					title="New page"
				>
					${svg("plus")}
				</button>
				<button class="row-btn folder-more" type="button" aria-label="${name} options" title="More">
					${svg("dots")}
				</button>
			</span>
		</div>
		<div class="folder-children" role="group">
			${node.folders.map((child) => folderItem(child, open, activeId))}
			${node.pages.map((page) => pageItem(page, activeId))}
			${empty ? html`<div class="folder-empty">Empty</div>` : ""}
		</div>
	</div>`;
}

/**
 * The sidebar tree (the contents of `#page-nav`). Folders holding the current
 * page render open; the client adds the ones the reader opened before.
 */
export function navItems(folders: FolderRow[], pages: PageRow[], activeId?: string): Markup {
	const tree = buildTree(folders, pages);
	const active = pages.find((page) => page.id === activeId);
	const open = new Set(folderPath(folders, active?.folder_id ?? null));
	return html`${tree.folders.map((node) => folderItem(node, open, activeId))}
	${tree.pages.map((page) => pageItem(page, activeId))}`;
}

export function shell(options: {
	title: string;
	pages: PageRow[];
	folders: FolderRow[];
	activeId?: string;
	createPath: string;
	createDatabasePath: string;
	/** Pages outside the sidebar (database rows, inline databases), so links to them show titles. */
	index: { id: string; title: string }[];
	actionPaths: Record<string, string>;
	body: Markup;
}): Markup {
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${options.title} · cfnotes</title>
				<link rel="icon" href="${FAVICON}" />
				${styles("site.css")} ${script("datastar.ts")} ${script("editor.ts")}
				${script("sidebar.ts")} ${script("page-chrome.ts")} ${script("search.ts")}
				${script("notices.ts")}
				<script>
					// Apply the saved collapsed state before first paint.
					try {
						if (localStorage.getItem("cfnotes:sidebar-collapsed") === "1")
							document.documentElement.classList.add("side-collapsed");
					} catch {}
				</script>
			</head>
			<body>
				<div class="app">
					<button class="side-show" type="button" aria-label="Open sidebar" title="Open sidebar">
						${svg("menu", 18)}
					</button>
					<div class="side-peek" aria-hidden="true"></div>
					<aside class="sidebar">
						<div class="sidebar-head">
							<span>cfnotes</span>
							<button
								class="side-hide"
								type="button"
								aria-label="Close sidebar"
								title="Close sidebar"
							>
								${svg("chevronsLeft", 18)}
							</button>
						</div>
						<button class="side-search" type="button">
							${svg("search")}<span>Search</span><kbd>⌘P</kbd>
						</button>
						<nav
							id="page-nav"
							class="nav"
							aria-label="Pages"
							data-actions="${JSON.stringify(options.actionPaths)}"
						>
							${navItems(options.folders, options.pages, options.activeId)}
						</nav>
						<div class="sidebar-foot">
							<form id="new-page-form" method="post" action="${options.createPath}">
								<button class="new-page" type="submit">${svg("plus")}<span>New page</span></button>
							</form>
							<form id="new-db-form" method="post" action="${options.createDatabasePath}">
								<button class="new-page new-database" type="submit">
									${svg("table")}<span>New database</span>
								</button>
							</form>
							<button class="new-page new-folder" type="button">
								${svg("folderPlus")}<span>New folder</span>
							</button>
							<a
								class="new-page trash-link${options.activeId === "trash" ? " is-active" : ""}"
								href="/trash"
							>
								${svg("trash")}<span>Trash</span>
							</a>
						</div>
					</aside>
					<script>
						// Every page is a full load, so keep the sidebar where the reader left it.
						// Inline and right after the sidebar: it runs before the first paint, so no jump.
						(() => {
							const side = document.currentScript.previousElementSibling;
							// Only the page list scrolls; the header and footer stay put.
							const list = side.querySelector(".nav");
							// Reopen the folders the reader left open (sidebar.ts keeps this list).
							try {
								const open = new Set(
									JSON.parse(localStorage.getItem("cfnotes:open-folders") ?? "[]"),
								);
								for (const folder of list.querySelectorAll(".tree-folder")) {
									if (!open.has(folder.dataset.folder)) continue;
									folder.classList.add("is-open");
									folder.querySelector(".folder-toggle").setAttribute("aria-expanded", "true");
								}
							} catch {}
							const key = "cfnotes:sidebar-scroll";
							try {
								list.scrollTop = Number(sessionStorage.getItem(key) ?? 0);
							} catch {}
							// Bring the current page's link into view if it is off-screen (e.g. just created).
							const active = side.querySelector(".nav-link.is-active");
							if (active) {
								const box = list.getBoundingClientRect();
								const link = active.getBoundingClientRect();
								if (link.top < box.top) list.scrollTop -= box.top - link.top + 4;
								else if (link.bottom > box.bottom) list.scrollTop += link.bottom - box.bottom + 4;
							}
							// Collapse / reopen. On desktop the choice is remembered; on narrow
							// screens the sidebar is always a drawer that opens over the page.
							const root = document.documentElement;
							const narrow = matchMedia("(max-width: 720px)");
							const setOpen = (open) => root.classList.toggle("side-open", open);
							const toggle = side.querySelector(".side-hide");
							// The header button collapses a docked sidebar and docks a peeking one.
							const syncLabel = () => {
								const label =
									!narrow.matches && root.classList.contains("side-collapsed")
										? "Keep sidebar open"
										: "Close sidebar";
								toggle.setAttribute("aria-label", label);
								toggle.title = label;
							};
							const setCollapsed = (collapsed) => {
								root.classList.toggle("side-collapsed", collapsed);
								syncLabel();
								try {
									localStorage.setItem("cfnotes:sidebar-collapsed", collapsed ? "1" : "0");
								} catch {}
							};
							syncLabel();
							narrow.addEventListener("change", syncLabel);
							side.parentElement.querySelector(".side-show").addEventListener("click", () => {
								if (narrow.matches) setOpen(true);
								else setCollapsed(false);
							});
							toggle.addEventListener("click", () => {
								if (narrow.matches) setOpen(false);
								else if (root.classList.contains("side-collapsed")) {
									setCollapsed(false);
									return;
								} else setCollapsed(true);
								// Still under the pointer (and focused): don't let that keep it peeking open.
								side.classList.add("is-leaving");
								document.activeElement?.blur();
							});
							side.addEventListener("pointerleave", () => side.classList.remove("is-leaving"));
							document.addEventListener("pointerdown", (e) => {
								if (
									root.classList.contains("side-open") &&
									!side.contains(e.target) &&
									!e.target.closest(".side-show")
								)
									setOpen(false);
							});
							document.addEventListener("keydown", (e) => {
								if (e.key === "Escape" && root.classList.contains("side-open")) setOpen(false);
							});
							addEventListener("pagehide", () => {
								try {
									sessionStorage.setItem(key, String(list.scrollTop));
								} catch {}
							});
						})();
					</script>
					<main class="main">${options.body}</main>
					<script type="application/json" id="page-index">
						${raw(JSON.stringify(options.index).replace(/</g, "\\u003c"))}
					</script>
				</div>
			</body>
		</html>`;
}
