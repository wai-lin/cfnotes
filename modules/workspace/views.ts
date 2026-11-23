import { html, raw, type Html } from "spacefn";
import { assets } from "spacefn/assets";

import { icon, type IconName } from "#lib/icons.ts";
import { accountView } from "#modules/auth/views.ts";
import type { FolderRow, PageRow } from "#modules/sidebar/tree.ts";
import { navItems } from "#modules/sidebar/views.ts";

const svg = (name: IconName, size?: number) => raw(icon(name, size));

/** The whole document: the sidebar, and a page's body beside it. */
export function shell(options: {
	title: string;
	user: { email: string };
	pages: readonly PageRow[];
	folders: readonly FolderRow[];
	activeId?: string;
	/** Pages outside the sidebar (database rows, inline databases), so links to them show titles. */
	index: readonly { id: string; title: string }[];
	/** The sidebar's actions on the page being shown. */
	urls: Record<string, string> & { create: string; createDatabase: string };
	body: Html;
}): Html {
	return html`<!doctype html>
		<html lang="en">
			<head>
				<meta charset="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<title>${options.title} · cfnotes</title>
				<link rel="icon" href="/favicon.svg" />
				${assets("site", "main")}
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
							data-actions="${JSON.stringify(options.urls)}"
						>
							${navItems(options.folders, options.pages, options.activeId)}
						</nav>
						<div class="sidebar-foot">
							<form id="new-page-form" method="post" action="${options.urls.create}">
								<button class="new-page" type="submit">${svg("plus")}<span>New page</span></button>
							</form>
							<form id="new-db-form" method="post" action="${options.urls.createDatabase}">
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
							${accountView(options.user)}
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
