import { mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getRoot,
	createEditor,
	type EditorThemeClasses,
	type LexicalEditor,
} from "lexical";

import type { EditorExtension, EditorSchema } from "./extension";
import { buildSchema } from "./schema";
import { theme as defaultTheme } from "./theme";

/** Tags the update that loads the saved document, so it isn't reported as an edit. */
const LOAD_TAG = "editor-load";

export interface MountOptions {
	extensions: EditorExtension[];
	/** The saved document (a serialized editor state), if any. */
	state?: string;
	namespace?: string;
	/** Accessible name of the text area. */
	label?: string;
	theme?: EditorThemeClasses;
	/** Called after each edit with the document as a JSON string. */
	onChange?: (json: string) => void;
	onError?: (error: Error) => void;
}

export interface EditorHandle {
	editor: LexicalEditor;
	/** The contenteditable element. */
	content: HTMLElement;
	schema: EditorSchema;
	/** The document now, as a JSON string. */
	getJSON(): string;
	focus(): void;
	/** Unregisters everything and detaches the editor. */
	destroy(): void;
}

/**
 * Mounts a rich-text editor in `host` (replacing its children). `host` should
 * be positioned: extensions put their overlays (handles, toolbars) in it.
 */
export function mountEditor(host: HTMLElement, options: MountOptions): EditorHandle {
	const onError = options.onError ?? ((error: Error) => console.error("[editor]", error));
	const schema = buildSchema(options.extensions, options.theme ?? defaultTheme);

	const content = document.createElement("div");
	content.className = "ne-content";
	content.contentEditable = "true";
	content.spellcheck = true;
	content.setAttribute("role", "textbox");
	content.setAttribute("aria-multiline", "true");
	content.setAttribute("aria-label", options.label ?? "Page content");
	host.replaceChildren(content);

	const editor = createEditor({
		namespace: options.namespace ?? "editor",
		theme: schema.theme,
		nodes: schema.nodes,
		html: { import: schema.html },
		onError,
	});
	editor.setRootElement(content);

	const context = { editor, host, schema };
	const unregister = mergeRegister(
		...options.extensions.flatMap((extension) => extension.register?.(context) ?? []),
	);

	load(editor, options.state ?? "", onError);

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
			options.onChange?.(json);
		},
	);

	return {
		editor,
		content,
		schema,
		getJSON: () => JSON.stringify(editor.getEditorState().toJSON()),
		focus: () => editor.focus(),
		destroy() {
			offChange();
			unregister();
			editor.setRootElement(null);
		},
	};
}

function load(editor: LexicalEditor, state: string, onError: (error: Error) => void): void {
	if (state) {
		try {
			editor.setEditorState(editor.parseEditorState(state), { tag: LOAD_TAG });
			return;
		} catch (error) {
			onError(new Error("could not load saved content", { cause: error }));
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
