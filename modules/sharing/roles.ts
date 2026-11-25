/** What each kind of access allows, and what a friend's sidebar holds. Pure, for tests. */
import type { FolderRow, PageRow } from "#modules/sidebar/tree.ts";

/** What a page or folder can be shared as, least first. */
export const ROLES = ["view", "comment", "edit"] as const;
export type Role = (typeof ROLES)[number];
/** A share's role, or `owner`: someone on ALLOWED_EMAILS, who may do anything. */
export type Access = Role | "owner";

const RANK: Record<Access, number> = { view: 1, comment: 2, edit: 3, owner: 4 };

/** Whether `access` allows what `min` does. No access allows nothing. */
export const atLeast = (access: Access | null | undefined, min: Access) =>
	access != null && RANK[access] >= RANK[min];

/** The role for a rank from the `page-roles` query. */
export const roleOfRank = (rank: number): Role =>
	rank >= 3 ? "edit" : rank === 2 ? "comment" : "view";

export const isRole = (value: unknown): value is Role =>
	typeof value === "string" && (ROLES as readonly string[]).includes(value);

/**
 * A friend's sidebar: each folder shared with them (with everything in it) and
 * each page shared on its own. Those sit at the top level when what holds them
 * isn't shared too.
 */
export function sharedTree(input: {
	/** Their shares. */
	shares: readonly { target_kind: string; target_id: string }[];
	/** Every folder, and every sidebar page. */
	folders: readonly FolderRow[];
	pages: readonly PageRow[];
	/** The pages shared with them directly, rows and inline databases included. */
	direct: readonly PageRow[];
}): { folders: FolderRow[]; pages: PageRow[] } {
	const children = new Map<string | null, FolderRow[]>();
	for (const folder of input.folders) {
		const list = children.get(folder.parent_id) ?? [];
		list.push(folder);
		children.set(folder.parent_id, list);
	}
	const inside = new Set<string>();
	const visit = (id: string) => {
		if (inside.has(id)) return;
		inside.add(id);
		for (const child of children.get(id) ?? []) visit(child.id);
	};
	const known = new Set(input.folders.map((folder) => folder.id));
	for (const share of input.shares)
		if (share.target_kind === "folder" && known.has(share.target_id)) visit(share.target_id);

	const folders = input.folders
		.filter((folder) => inside.has(folder.id))
		.map((folder) =>
			folder.parent_id !== null && inside.has(folder.parent_id)
				? folder
				: { ...folder, parent_id: null },
		);
	const seen = new Set<string>();
	const pages: PageRow[] = [];
	for (const page of input.pages) {
		if (page.folder_id === null || !inside.has(page.folder_id)) continue;
		seen.add(page.id);
		pages.push(page);
	}
	for (const page of input.direct) {
		if (seen.has(page.id)) continue;
		seen.add(page.id);
		pages.push({ ...page, folder_id: null });
	}
	return { folders, pages };
}
