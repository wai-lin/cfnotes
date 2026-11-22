/**
 * "Moved to Trash" toasts with a countdown and Undo. Undo restores the item
 * through the sidebar's `restorePage` action, which answers with the new
 * tree, then either reopens the item or lets the caller put it back in place.
 */

import { alertDialog } from "#lib/ui/dialog.ts";
import { toast } from "#lib/ui/toast.ts";

/** How long Undo is offered. */
export const UNDO_MS = 8000;

export type ArchiveToast = {
	id: string;
	title: string;
	/** Go back to the item after restoring it (it was the open page). */
	reopen?: boolean;
	/** Keep an inline database attached to its page (the caller puts the block back). */
	keepHost?: boolean;
	/** Runs after a successful restore, unless `reopen`. */
	onUndone?: () => void;
	/** Time left on the Undo, when it continues from the previous page. */
	remaining?: number;
};

/** What `restoreFolder` needs to bring a deleted folder back (the delete's `x-undo`). */
export type FolderUndo = Record<string, unknown>;

const label = (title: string) => title.trim() || "Untitled";

/** A sidebar action's path on this page (from `#page-nav[data-actions]`). */
function actionPath(name: string): string | undefined {
	const nav = document.querySelector<HTMLElement>("#page-nav");
	return (JSON.parse(nav?.dataset.actions ?? "{}") as Record<string, string>)[name];
}

/** Restores an archived item. Resolves `true` when it's back. */
export async function restoreArchived(id: string, keepHost = false): Promise<boolean> {
	const path = actionPath("restorePage");
	try {
		if (!path) throw new Error("no restorePage action");
		const res = await fetch(location.pathname + path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id, keepHost }),
		});
		if (res.status === 409) {
			const { message } = (await res.json()) as { message?: string };
			void alertDialog("Couldn't restore it", message ?? "It isn't in Trash any more.");
			return false;
		}
		if (!res.ok) throw new Error(`restorePage failed: ${res.status}`);
		document.dispatchEvent(new CustomEvent("cfnotes:tree", { detail: await res.text() }));
		return true;
	} catch (error) {
		console.warn(error);
		void alertDialog("Couldn't restore it", "Check your connection and try again.");
		return false;
	}
}

/** Shows "Moved … to Trash" with a countdown and an Undo button. */
export function archivedToast(item: ArchiveToast): void {
	toast({
		title: `Moved “${label(item.title)}” to Trash`,
		duration: UNDO_MS,
		countdown: true,
		remaining: item.remaining,
		// On another page the block (or row) can't be put back in place, so Undo
		// there just restores it.
		carry: { title: item.title, undoArchive: { id: item.id } },
		action: {
			label: "Undo",
			run: async () => {
				if (!(await restoreArchived(item.id, item.keepHost))) return;
				if (item.reopen) location.assign(`/p/${item.id}`);
				else {
					item.onUndone?.();
					toast({ title: `Restored “${label(item.title)}”` });
				}
			},
		},
	});
}

/** Brings back a deleted folder with what was in it. Resolves `true` when it's back. */
async function restoreFolder(undo: FolderUndo): Promise<boolean> {
	const path = actionPath("restoreFolder");
	try {
		if (!path) throw new Error("no restoreFolder action");
		const res = await fetch(location.pathname + path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(undo),
		});
		if (!res.ok) throw new Error(`restoreFolder failed: ${res.status}`);
		document.dispatchEvent(new CustomEvent("cfnotes:tree", { detail: await res.text() }));
		return true;
	} catch (error) {
		console.warn(error);
		void alertDialog("Couldn't restore it", "Check your connection and try again.");
		return false;
	}
}

/** Shows "Deleted the folder …" with a countdown and an Undo button. */
export function folderToast(name: string, undo: FolderUndo, remaining?: number): void {
	toast({
		title: `Deleted the folder “${name}”`,
		duration: UNDO_MS,
		countdown: true,
		remaining,
		carry: { title: name, undoFolder: undo },
		action: {
			label: "Undo",
			run: async () => {
				if (await restoreFolder(undo)) toast({ title: `Restored the folder “${name}”` });
			},
		},
	});
}
