/**
 * What the editor library needs from cfnotes: where files and pages are
 * stored, how databases are made, and how failures are told to the reader.
 */
import { IMAGE_TYPES, type LinkPreview, type Uploaded } from "#lib/editor/index.ts";
import { alertDialog } from "#lib/ui/dialog.ts";
import { primeState } from "#modules/database/client/database-view.ts";
import type { DatabaseState } from "#modules/database/columns.ts";
import { archivedToast } from "#modules/trash/client/undo.ts";

const tryAgain = "Check your connection and try again.";

/**
 * Uploads one file to R2 through the matching route: images render inline,
 * everything else becomes a downloadable attachment.
 */
export async function upload(file: File): Promise<Uploaded | null> {
	const image = IMAGE_TYPES.includes(file.type);
	const body = new FormData();
	body.append("file", file);
	try {
		const res = await fetch(image ? "/files" : "/files/attach", { method: "POST", body });
		if (!res.ok) throw new Error(`upload failed: ${res.status}`);
		const { key } = (await res.json()) as { key: string };
		return image
			? { kind: "image", src: `/files/${key}`, alt: file.name.replace(/\.\w+$/, "") }
			: { kind: "file", src: `/files/${key}`, name: file.name, size: file.size };
	} catch (error) {
		console.warn("[upload]", error);
		void alertDialog(`Couldn't upload “${file.name}”`, tryAgain);
		return null;
	}
}

/** Our uploaded images, which pasted HTML may keep. */
export const isUploadedImage = (src: string) => src.startsWith("/files/img/");

/** A bookmark's preview, through the same-origin `/unfurl` route. */
export async function fetchPreview(url: string): Promise<LinkPreview | null> {
	const res = await fetch(`/unfurl?url=${encodeURIComponent(url)}`);
	return res.ok ? ((await res.json()) as LinkPreview) : null;
}

/** POSTs JSON to a page action of the page being shown. */
async function postAction<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(location.pathname + path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
	return (await res.json()) as T;
}

/** Makes a page from the `[[` picker (through the page action `path`); its id. */
export function pageCreator(path: string | undefined) {
	if (!path) return undefined;
	return async (title: string): Promise<string | null> => {
		try {
			const made = await postAction<{ id: string; tree: string }>(path, { title });
			// Update the sidebar first so the new link can show the page's title.
			document.dispatchEvent(new CustomEvent("cfnotes:tree", { detail: made.tree }));
			return made.id;
		} catch (error) {
			console.warn(error);
			void alertDialog("Couldn't create the page", tryAgain);
			return null;
		}
	};
}

/** Makes an inline database through the page's `data-db-path` action; its id. */
export function databaseCreator(host: HTMLElement) {
	return async (): Promise<string | null> => {
		const path = host.closest<HTMLElement>("[data-db-path]")?.dataset.dbPath;
		if (!path) return null;
		try {
			const { state } = await postAction<{ state: DatabaseState }>(path, { op: "create" });
			primeState(state);
			return state.id;
		} catch (error) {
			console.warn(error);
			void alertDialog("Couldn't create the database", tryAgain);
			return null;
		}
	};
}

/**
 * "Delete database" in its ⋯ menu: it went to Trash and the editor dropped
 * its block. Offer Undo, which restores it and puts the block back.
 */
export function databaseDeleted(
	event: CustomEvent<{ id: string; title?: string }>,
	restore: () => void,
): void {
	const { id, title = "" } = event.detail;
	archivedToast({ id, title, keepHost: true, onUndone: restore });
}
