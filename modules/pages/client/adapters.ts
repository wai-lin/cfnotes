/**
 * What the editor library needs from cfnotes: where files and pages are
 * stored, how databases are made, and how failures are told to the reader.
 */
import {
	IMAGE_TYPES,
	type LinkPreview,
	type MediaKind,
	type SyncedStore,
	type Uploaded,
} from "#lib/editor/index.ts";
import { alertDialog } from "#lib/ui/dialog.ts";
import { primeState } from "#modules/database/client/database-view.ts";
import type { DatabaseState } from "#modules/database/columns.ts";
import { archivedToast } from "#modules/trash/client/undo.ts";

const tryAgain = "Check your connection and try again.";

/** What a stored media type plays as. */
const mediaKind = (type: string): MediaKind | null =>
	type === "application/pdf"
		? "pdf"
		: type.startsWith("audio/")
			? "audio"
			: type.startsWith("video/")
				? "video"
				: null;

/** POSTs a file to an upload route; its stored key and type, or why not. */
async function send(route: string, file: File) {
	const body = new FormData();
	body.append("file", file);
	const res = await fetch(route, { method: "POST", body });
	if (!res.ok) return { status: res.status } as const;
	return (await res.json()) as { key: string; type: string };
}

/**
 * Uploads one file to R2 through the matching route: images render inline,
 * audio, video and PDFs play in the page (when the server recognises them),
 * everything else becomes a downloadable attachment.
 */
export async function upload(file: File): Promise<Uploaded | null> {
	try {
		if (IMAGE_TYPES.includes(file.type)) {
			const sent = await send("/files", file);
			if ("status" in sent) throw new Error(`upload failed: ${sent.status}`);
			return { kind: "image", src: `/files/${sent.key}`, alt: file.name.replace(/\.\w+$/, "") };
		}
		if (mediaKind(file.type)) {
			const sent = await send("/files/media", file);
			const media = "key" in sent ? mediaKind(sent.type) : null;
			if ("key" in sent && media)
				return {
					kind: "media",
					media,
					src: `/files/${sent.key}`,
					name: file.name,
					size: file.size,
				};
			// Too big, or a format we can't play: it can still be attached.
			if ("status" in sent && sent.status !== 413 && sent.status !== 415)
				throw new Error(`upload failed: ${sent.status}`);
		}
		const sent = await send("/files/attach", file);
		if ("status" in sent) throw new Error(`upload failed: ${sent.status}`);
		return { kind: "file", src: `/files/${sent.key}`, name: file.name, size: file.size };
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

/** Synced blocks' content, through the page action `path`. */
export function syncedStore(path: string | undefined): SyncedStore | undefined {
	if (!path) return undefined;
	const call = (body: unknown, keepalive = false) =>
		fetch(location.pathname + path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			keepalive,
		});
	return {
		async load(ids) {
			const res = await call({ op: "get", ids });
			if (!res.ok) return null;
			return ((await res.json()) as { blocks: Record<string, unknown[]> }).blocks;
		},
		async save(id, content, keepalive) {
			try {
				const body = { op: "save", id, content };
				// Browsers cap a keepalive request at 64 KB.
				const small = new Blob([JSON.stringify(body)]).size <= 60_000;
				return (await call(body, keepalive && small)).ok;
			} catch (error) {
				console.warn("[synced] save failed", error);
				return false;
			}
		},
	};
}
