import { html, raw, type Html } from "spacefn";

import { icon, type IconName } from "#lib/icons.ts";
import { pageLabel } from "#lib/titles.ts";

import { buildTree, folderPath, type FolderNode, type FolderRow, type PageRow } from "./tree.ts";

/** A Tabler icon as markup (see `lib/icons.ts`). */
const svg = (name: IconName, size?: number) => raw(icon(name, size));

export interface NavPage {
	id: string;
	title: string;
	kind?: string;
	icon?: string | null;
}

/**
 * Sidebar link: the page's emoji, or the icon for its kind (page or database),
 * then its title. Its id lets actions patch it after a rename.
 */
export function navLink(page: NavPage, activeId?: string): Html {
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

/** A friend's tree is only for opening pages: nothing to drag, add or change. */
interface TreeOptions {
	guest?: boolean;
}

function pageItem(page: PageRow, activeId?: string, { guest }: TreeOptions = {}): Html {
	if (guest)
		return html`<div class="tree-page" data-page="${page.id}">${navLink(page, activeId)}</div>`;
	return html`<div class="tree-page" data-page="${page.id}" draggable="true">
		${navLink(page, activeId)}
		<button class="row-btn page-more" type="button" aria-label="Page options" title="More">
			${svg("dots")}
		</button>
	</div>`;
}

function folderItem(
	node: FolderNode,
	open: Set<string>,
	activeId?: string,
	options: TreeOptions = {},
): Html {
	const { id, name } = node.folder;
	const isOpen = open.has(id);
	const empty = node.folders.length === 0 && node.pages.length === 0;
	return html`<div class="tree-folder${isOpen ? " is-open" : ""}" data-folder="${id}">
		<div class="tree-row folder-row" draggable="${options.guest ? "false" : "true"}">
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
			${options.guest ? "" : folderActions(id, name)}
		</div>
		<div class="folder-children" role="group">
			${node.folders.map((child) => folderItem(child, open, activeId, options))}
			${node.pages.map((page) => pageItem(page, activeId, options))}
			${empty ? html`<div class="folder-empty">Empty</div>` : ""}
		</div>
	</div>`;
}

function folderActions(id: string, name: string): Html {
	return html`<span class="row-actions">
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
	</span>`;
}

/**
 * The sidebar tree (the contents of `#page-nav`). Folders holding the current
 * page render open; the client adds the ones the reader opened before.
 */
export function navItems(
	folders: readonly FolderRow[],
	pages: readonly PageRow[],
	activeId?: string,
	options: TreeOptions = {},
): Html {
	const tree = buildTree(folders, pages);
	const active = pages.find((page) => page.id === activeId);
	const open = new Set(folderPath(folders, active?.folder_id ?? null));
	return html`${tree.folders.map((node) => folderItem(node, open, activeId, options))}
	${tree.pages.map((page) => pageItem(page, activeId, options))}`;
}
