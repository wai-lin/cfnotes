/** Folder tree for the sidebar: pure functions over the `folders` and `pages` rows. */

export interface FolderRow {
	id: string;
	parent_id: string | null;
	name: string;
}

export interface PageRow {
	id: string;
	folder_id: string | null;
	title: string;
	/** 'page' or 'database'. */
	kind?: string;
	/** Emoji shown in place of the default icon. */
	icon?: string | null;
}

export interface FolderNode {
	folder: FolderRow;
	folders: FolderNode[];
	pages: PageRow[];
}

export interface Tree {
	folders: FolderNode[];
	pages: PageRow[];
}

export const MAX_FOLDER_NAME = 100;

/** Trims and collapses whitespace; `null` when nothing is left. */
export function cleanFolderName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME);
	return name || null;
}

/** Parent links that resolve, with cycles broken (a looping folder is treated as top level). */
function parents(folders: readonly FolderRow[]): Map<string, string | null> {
	const byId = new Map(folders.map((f) => [f.id, f]));
	const result = new Map<string, string | null>();
	for (const folder of folders) {
		const parent = folder.parent_id && byId.has(folder.parent_id) ? folder.parent_id : null;
		result.set(folder.id, parent);
	}
	for (const folder of folders) {
		const seen = new Set<string>([folder.id]);
		let at = result.get(folder.id) ?? null;
		while (at) {
			if (seen.has(at)) {
				result.set(folder.id, null);
				break;
			}
			seen.add(at);
			at = result.get(at) ?? null;
		}
	}
	return result;
}

/** Nests folders and pages. Rows whose folder is missing land at the top level. Input order is kept. */
export function buildTree(folders: readonly FolderRow[], pages: readonly PageRow[]): Tree {
	const parentOf = parents(folders);
	const nodes = new Map<string, FolderNode>(
		folders.map((folder) => [folder.id, { folder, folders: [], pages: [] }]),
	);
	const tree: Tree = { folders: [], pages: [] };
	for (const folder of folders) {
		const node = nodes.get(folder.id)!;
		const parent = parentOf.get(folder.id);
		(parent ? nodes.get(parent)!.folders : tree.folders).push(node);
	}
	for (const page of pages) {
		const home = page.folder_id ? nodes.get(page.folder_id) : undefined;
		(home ? home.pages : tree.pages).push(page);
	}
	return tree;
}

/** Ids of the folder and every folder above it, nearest first. */
export function folderPath(folders: readonly FolderRow[], folderId: string | null): string[] {
	const parentOf = parents(folders);
	const path: string[] = [];
	let at = folderId && parentOf.has(folderId) ? folderId : null;
	while (at) {
		path.push(at);
		at = parentOf.get(at) ?? null;
	}
	return path;
}

/** True when `folderId` is `ancestorId` or sits somewhere inside it. */
export function isWithin(
	folders: readonly FolderRow[],
	folderId: string | null,
	ancestorId: string,
): boolean {
	return folderPath(folders, folderId).includes(ancestorId);
}
