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

/**
 * A friend's tree opens pages, and changes things only in the folders shared
 * with them to edit (`editable`): what's in those, and what they hold.
 */
interface TreeOptions {
	guest?: boolean;
	editable?: ReadonlySet<string>;
}

/** Whether the reader may add to folder `id` (`null` is the top level, an owner's). */
const mayEdit = (id: string | null, { guest, editable }: TreeOptions) =>
	!guest || (id !== null && (editable?.has(id) ?? false));

/** Marks a locked page or folder in the tree. */
const lockMark = (locked: boolean) =>
	locked ? html`<span class="tree-lock" title="Locked">${svg("lock", 14)}</span>` : "";

function pageItem(page: PageRow, activeId?: string, options: TreeOptions = {}): Html {
	const locked = page.locked_at != null;
	// A friend can't move or delete a locked page, even in a folder they edit.
	if (!mayEdit(page.folder_id, options) || (options.guest && locked))
		return html`<div class="tree-page" data-page="${page.id}" data-locked="${locked ? "true" : ""}">
			${navLink(page, activeId)}${lockMark(locked)}
		</div>`;
	return html`<div
		class="tree-page"
		data-page="${page.id}"
		data-locked="${locked ? "true" : ""}"
		draggable="true"
	>
		${navLink(page, activeId)}${lockMark(locked)}
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
	const editable = mayEdit(id, options);
	// Taking it out of its parent is an edit of that: a folder shared with a friend stays put.
	const movable = editable && mayEdit(node.folder.parent_id, options);
	return html`<div
		class="tree-folder${isOpen ? " is-open" : ""}"
		data-folder="${id}"
		data-editable="${editable ? "true" : ""}"
		data-movable="${movable ? "true" : ""}"
		data-locked="${node.folder.locked_at != null ? "true" : ""}"
	>
		<div class="tree-row folder-row" draggable="${movable ? "true" : "false"}">
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
			${lockMark(node.folder.locked_at != null)} ${editable ? folderActions(id, name) : ""}
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
