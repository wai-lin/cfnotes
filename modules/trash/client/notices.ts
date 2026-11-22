/**
 * Page-wide notices, loaded on every page: forms that confirm in a modal
 * (`data-confirm`), toasts queued by the previous page, and the "Moved to Trash"
 * toast with Undo after a page's Delete button trashed it (the redirect
 * carries `?trashed=&title=`).
 */

import { registerConfirmForms } from "#lib/ui/dialog.ts";
import { takePendingToasts, toast } from "#lib/ui/toast.ts";

import { archivedToast, folderToast } from "./undo.ts";

registerConfirmForms();

for (const pending of takePendingToasts()) {
	const { undoArchive, undoFolder, ...options } = pending;
	if (undoArchive)
		archivedToast({
			id: undoArchive.id,
			title: options.title,
			reopen: undoArchive.reopen,
			remaining: options.remaining,
		});
	else if (undoFolder) folderToast(options.title, undoFolder, options.remaining);
	else toast(options);
}

const params = new URLSearchParams(location.search);
const trashed = params.get("trashed");
if (trashed) {
	archivedToast({
		id: trashed,
		title: params.get("title") ?? "",
		reopen: true,
	});
	for (const key of ["trashed", "title"]) params.delete(key);
	const query = params.toString();
	history.replaceState(
		history.state,
		"",
		location.pathname + (query ? `?${query}` : "") + location.hash,
	);
}
