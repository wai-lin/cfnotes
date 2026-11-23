/**
 * `<notes-editor state="…" save-path="…" link-path="…">`: the page editor
 * (`lib/editor`) as a Rocket element, wired to cfnotes' pages, files and databases.
 *
 * Lexical owns what's inside, so the element is light DOM (the site's styles
 * and the editor's overlays reach it), has no `render`, keeps its children
 * through morphs, and is marked `data-ignore` so Datastar doesn't scan them.
 *
 * It reports edits with a bubbling `notes-change` event whose `detail` is the
 * serialized editor state as a JSON string. `save-path` (a page action) lets
 * it save on its own when the reader leaves right after an edit, before the
 * page's debounced save has run. `link-path` is the action that creates a page
 * from the `[[` picker.
 */
import { rocket } from "#lib/datastar/index.ts";
import { mountEditor, notionLikeExtensions } from "#lib/editor/index.ts";
import {
	pageDirectory,
	pageHref,
	pageIdFromUrl,
} from "#modules/workspace/client/page-directory.ts";

import {
	databaseCreator,
	databaseDeleted,
	fetchPreview,
	isUploadedImage,
	pageCreator,
	upload,
} from "./adapters.ts";

/** What other scripts can call on the element. */
export interface NotesEditorElement extends HTMLElement {
	/**
	 * Saves now if there's an edit the debounced save may not have sent yet.
	 * `false` when that didn't work.
	 */
	flush?: (keepalive?: boolean) => Promise<boolean>;
	/** Reports the edits again, so the page saves them, as after saves that failed. */
	resave?: () => void;
}

interface Edits {
	doc: string;
	/** When the last edit was reported (0 = none since load or since the last flush). */
	changedAt: number;
}

// Per element and not per mount: moving the element in the DOM mounts it
// again, and that must start from what was typed, not from the `state` attribute.
const editsOf = new WeakMap<HTMLElement, Edits>();

export const defineNotesEditor = () =>
	rocket("notes-editor", {
		mode: "light",
		ignoredByMorph: "children",
		renderOnPropChange: false,
		props: ({ string }) => ({ state: string, savePath: string, linkPath: string }),
		onFirstRender({ host, props, cleanup, defineHostProp }) {
			const edits = editsOf.get(host) ?? { doc: props.state, changedAt: 0 };
			editsOf.set(host, edits);

			/**
			 * Saves if there was an edit in the last few seconds; saving the same
			 * state twice is harmless. `keepalive` lets the request outlive the
			 * page; browsers cap that at 64 KB.
			 */
			const flush = async (keepalive = false) => {
				if (!props.savePath || Date.now() - edits.changedAt > 3000) return true;
				const { changedAt } = edits;
				edits.changedAt = 0;
				const body = JSON.stringify({ doc: edits.doc });
				try {
					const res = await fetch(location.pathname + props.savePath, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body,
						keepalive: keepalive && new Blob([body]).size <= 60_000,
					});
					if (res.ok) return true;
				} catch (error) {
					console.warn("[notes-editor] save on leave failed", error);
				}
				// Still pending, unless there has been a newer edit since.
				edits.changedAt ||= changedAt;
				return false;
			};

			// Not Rocket's `emit`: it reads a string detail as a second event's name.
			const report = () =>
				host.dispatchEvent(new CustomEvent("notes-change", { bubbles: true, detail: edits.doc }));

			const editor = mountEditor(host, {
				namespace: "cfnotes",
				extensions: notionLikeExtensions({
					upload,
					localImageSource: isUploadedImage,
					pages: {
						directory: pageDirectory,
						href: pageHref,
						parseUrl: pageIdFromUrl,
						// Save any last edits before leaving for the linked page.
						open: (href) => void flush().finally(() => location.assign(href)),
						createPage: pageCreator(props.linkPath),
					},
					database: {
						element: "cf-database",
						create: databaseCreator(host),
						deletedEvent: "cf-database-deleted",
						onDeleted: databaseDeleted,
					},
					fetchPreview,
					blockSelect: {
						marqueeArea: ".main",
						marqueeIgnore:
							".page-head, .page-title, .page-bar, .page-cover, .backlinks, cf-database",
					},
					undoIgnore: "cf-database, .db-pop",
				}),
				state: edits.doc,
				onChange(doc) {
					edits.doc = doc;
					edits.changedAt = Date.now();
					report();
				},
				onError: (error) => console.error("[notes-editor]", error),
			});

			defineHostProp("flush", { value: flush });
			defineHostProp("resave", {
				value: () => {
					if (edits.doc !== props.state) report();
				},
			});
			defineHostProp("focus", { value: () => editor.focus() });

			// Leaving the page (a sidebar link, a reload, closing the tab): save what's pending.
			const onLeave = () => void flush(true);
			addEventListener("pagehide", onLeave);
			cleanup(() => {
				removeEventListener("pagehide", onLeave);
				editor.destroy();
			});
		},
	});
