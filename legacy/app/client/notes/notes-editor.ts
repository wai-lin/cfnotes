import { mountEditor, notionLikeExtensions, type EditorHandle } from "@lib/editor";

import { pageDirectory, pageHref, pageIdFromUrl } from "../_page-directory";
import {
	databaseCreator,
	databaseDeleted,
	fetchPreview,
	isUploadedImage,
	pageCreator,
	upload,
} from "./adapters";

/**
 * `<notes-editor data-state="…">`: the page editor (`lib/editor`) as a plain
 * custom element, wired to cfnotes' pages, files and databases.
 *
 * It owns its DOM (mark it `data-ignore` so Datastar leaves it alone) and reports
 * edits with a bubbling `notes-change` event whose `detail` is the serialized
 * editor state as a JSON string.
 *
 * `data-save-path` (a page action) lets it save on its own when the reader
 * leaves right after an edit, before the page's debounced save has run.
 * `data-link-path` is the action that creates a page from the `[[` picker.
 */
export class NotesEditor extends HTMLElement {
	#handle: EditorHandle | null = null;
	#cleanup: (() => void) | null = null;
	/** When the last edit was reported (0 = none since load or since the last flush). */
	#lastChange = 0;
	#savePath = "";

	connectedCallback(): void {
		if (this.#handle) return;

		const extensions = notionLikeExtensions({
			upload,
			localImageSource: isUploadedImage,
			pages: {
				directory: pageDirectory,
				href: pageHref,
				parseUrl: pageIdFromUrl,
				// Save any last edits before leaving for the linked page.
				open: (href) => void this.flush().finally(() => location.assign(href)),
				createPage: pageCreator(this.dataset.linkPath),
			},
			database: {
				element: "cf-database",
				create: databaseCreator(this),
				deletedEvent: "cf-database-deleted",
				onDeleted: databaseDeleted,
			},
			fetchPreview,
			blockSelect: {
				marqueeArea: ".main",
				marqueeIgnore: ".page-head, .page-title, .page-bar, .page-cover, .backlinks, cf-database",
			},
			undoIgnore: "cf-database, .db-pop",
		});

		this.#handle = mountEditor(this, {
			namespace: "cfnotes",
			extensions,
			state: this.dataset.state ?? "",
			onChange: (json) => {
				this.#lastChange = Date.now();
				this.dispatchEvent(new CustomEvent("notes-change", { bubbles: true, detail: json }));
			},
			onError: (error) => console.error("[notes-editor]", error),
		});
		this.removeAttribute("data-state");
		this.#savePath = this.dataset.savePath ?? "";

		// Leaving the page (a sidebar link, a reload, closing the tab): save what's pending.
		const onLeave = () => void this.flush(true);
		addEventListener("pagehide", onLeave);
		this.#cleanup = () => removeEventListener("pagehide", onLeave);
	}

	disconnectedCallback(): void {
		this.#cleanup?.();
		this.#cleanup = null;
		this.#handle?.destroy();
		this.#handle = null;
	}

	/**
	 * Saves now if there was an edit in the last few seconds (the debounced save
	 * may not have run or finished yet). Saving the same state twice is harmless.
	 * `keepalive` lets the request outlive the page; browsers cap that at 64 KB.
	 */
	async flush(keepalive = false): Promise<void> {
		const handle = this.#handle;
		if (!handle || !this.#savePath || Date.now() - this.#lastChange > 3000) return;
		this.#lastChange = 0;
		const body = JSON.stringify({ doc: handle.getJSON() });
		if (keepalive && body.length > 60_000) keepalive = false;
		try {
			await fetch(location.pathname + this.#savePath, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body,
				keepalive,
			});
		} catch (error) {
			console.warn("[notes-editor] save on leave failed", error);
		}
	}

	override focus(): void {
		this.#handle?.focus();
	}
}
