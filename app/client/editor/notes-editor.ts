import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { registerCheckList, registerList } from "@lexical/list";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import { registerRichText } from "@lexical/rich-text";
import {
	registerTablePlugin,
	registerTableSelectionObserver,
	setScrollableTablesActive,
} from "@lexical/table";
import { mergeRegister } from "@lexical/utils";
import { $createParagraphNode, $getRoot, createEditor, type LexicalEditor } from "lexical";

import { registerBlockHandles } from "./block-handles";
import { registerBlockSelect } from "./block-select";
import { registerCallouts } from "./callout-node";
import { registerLazyHighlighting } from "./code-lazy";
import { registerCodeToolbar } from "./code-toolbar";
import { registerColumns } from "./columns-node";
import { registerDatabases } from "./database-node";
import { registerEmbeds } from "./embed-node";
import { registerEquations } from "./equation-node";
import { registerFiles } from "./file-node";
import { registerFormatToolbar } from "./format-toolbar";
import { registerImages } from "./image-node";
import { registerLinkUI } from "./link-ui";
import { registerMermaid } from "./mermaid-preview";
import { EDITOR_NODES, MARKDOWN_TRANSFORMERS } from "./nodes";
import { registerPageLinks } from "./page-link-node";
import { registerPagePicker } from "./page-picker";
import { registerPageUndo } from "./page-undo";
import { HTML_IMPORT, registerPaste } from "./paste";
import { registerPlaceholder } from "./placeholder";
import { registerShortcuts } from "./shortcuts";
import { registerSlashMenu } from "./slash-menu";
import { registerTableControls } from "./table-controls";
import { theme } from "./theme";
import { registerToggles } from "./toggle-node";
import { registerTrailingLine } from "./trailing-line";

const LOAD_TAG = "cfnotes-load";

/**
 * `<notes-editor data-state="…">` — a Lexical rich-text editor as a plain custom element.
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
	#editor: LexicalEditor | null = null;
	#cleanup: (() => void) | null = null;
	/** When the last edit was reported (0 = none since load or since the last flush). */
	#lastChange = 0;
	#savePath = "";

	connectedCallback(): void {
		if (this.#editor) return;

		const content = document.createElement("div");
		content.className = "ne-content";
		content.contentEditable = "true";
		content.spellcheck = true;
		content.setAttribute("role", "textbox");
		content.setAttribute("aria-multiline", "true");
		content.setAttribute("aria-label", "Page content");
		this.replaceChildren(content);

		const editor = createEditor({
			namespace: "cfnotes",
			theme,
			nodes: EDITOR_NODES,
			html: { import: HTML_IMPORT },
			onError: (error) => console.error("[notes-editor]", error),
		});
		// Wide tables scroll sideways inside their own wrapper instead of the page.
		setScrollableTablesActive(editor, true);
		editor.setRootElement(content);

		const unregister = mergeRegister(
			registerRichText(editor),
			registerHistory(editor, createEmptyHistoryState(), 300),
			registerList(editor),
			registerCheckList(editor),
			registerMarkdownShortcuts(editor, MARKDOWN_TRANSFORMERS),
			registerSlashMenu(editor),
			registerPlaceholder(editor),
			registerTablePlugin(editor),
			registerTableSelectionObserver(editor, true), // Tab moves between cells
			registerTableControls(editor, this),
			registerLazyHighlighting(editor),
			registerCodeToolbar(editor, this),
			registerPageLinks(editor, this),
			registerDatabases(editor, this),
			registerPagePicker(editor, this.dataset.linkPath),
			registerBlockHandles(editor, this),
			registerFormatToolbar(editor),
			registerLinkUI(editor),
			registerToggles(editor),
			registerCallouts(editor),
			registerImages(editor, this),
			registerFiles(editor, this),
			registerShortcuts(editor),
			registerPaste(editor),
			registerBlockSelect(editor),
			registerColumns(editor, this),
			registerEquations(editor, this),
			registerEmbeds(editor, this),
			registerMermaid(editor),
			registerTrailingLine(editor),
			registerPageUndo(editor),
		);
		this.#savePath = this.dataset.savePath ?? "";

		this.#load(editor, this.dataset.state ?? "");
		this.removeAttribute("data-state");
		// Re-highlighting after a grammar loads touches nodes without changing the
		// document; only report states that differ from the last one reported.
		let last = JSON.stringify(editor.getEditorState().toJSON());

		const offChange = editor.registerUpdateListener(
			({ editorState, dirtyElements, dirtyLeaves, tags }) => {
				if (tags.has(LOAD_TAG)) {
					last = JSON.stringify(editorState.toJSON());
					return;
				}
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return; // selection-only update
				const json = JSON.stringify(editorState.toJSON());
				if (json === last) return;
				last = json;
				this.#lastChange = Date.now();
				this.dispatchEvent(new CustomEvent("notes-change", { bubbles: true, detail: json }));
			},
		);

		// Leaving the page (a sidebar link, a reload, closing the tab): save what's pending.
		const onLeave = () => void this.flush(true);
		addEventListener("pagehide", onLeave);

		this.#editor = editor;
		this.#cleanup = () => {
			removeEventListener("pagehide", onLeave);
			offChange();
			unregister();
			editor.setRootElement(null);
		};
	}

	disconnectedCallback(): void {
		this.#cleanup?.();
		this.#cleanup = null;
		this.#editor = null;
	}

	/**
	 * Saves now if there was an edit in the last few seconds (the debounced save
	 * may not have run or finished yet). Saving the same state twice is harmless.
	 * `keepalive` lets the request outlive the page; browsers cap that at 64 KB.
	 */
	async flush(keepalive = false): Promise<void> {
		const editor = this.#editor;
		if (!editor || !this.#savePath || Date.now() - this.#lastChange > 3000) return;
		this.#lastChange = 0;
		const body = JSON.stringify({ doc: JSON.stringify(editor.getEditorState().toJSON()) });
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
		this.#editor?.focus();
	}

	#load(editor: LexicalEditor, state: string): void {
		if (state) {
			try {
				editor.setEditorState(editor.parseEditorState(state), { tag: LOAD_TAG });
				return;
			} catch (error) {
				console.error("[notes-editor] could not load saved content", error);
			}
		}
		editor.update(
			() => {
				const root = $getRoot();
				if (root.isEmpty()) root.append($createParagraphNode());
			},
			{ tag: LOAD_TAG, discrete: true },
		);
	}
}
