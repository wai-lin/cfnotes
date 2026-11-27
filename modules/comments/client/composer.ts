/**
 * The comment box: a small editor with formatting (shortcuts and Markdown
 * typing), lists, links, `@` mentions and `[[` links to pages and databases.
 * Enter sends (in a list, a new item), Shift+Enter is a new line, ⌘/Ctrl+Enter
 * always sends, Escape cancels. What it sends is Markdown.
 *
 * A box lives across redraws of the panel (the panel moves it, it isn't made
 * again), so what's typed, the caret and the undo history stay.
 */
import { $isListItemNode } from "@lexical/list";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
} from "lexical";

import {
	historyExtension,
	linkExtension,
	listExtension,
	markdownExtension,
	mentionExtension,
	mountEditor,
	pageLinkExtension,
	pagePickerExtension,
	placeholderExtension,
	richTextExtension,
	type EditorExtension,
	type EditorHandle,
	type Person,
} from "#lib/editor/index.ts";
import { icon } from "#lib/icons.ts";
import {
	pageDirectory,
	pageHref,
	pageIdFromUrl,
} from "#modules/workspace/client/page-directory.ts";

import { commentState, toCommentMarkdown } from "./body.ts";

/** Longest comment, in characters (as the server allows). */
const MAX_BODY = 10_000;

export interface ComposerOptions {
	placeholder: string;
	/** What it starts with (Markdown), for editing a comment. */
	value?: string;
	label: string;
	onSend: (markdown: string) => Promise<boolean>;
	onCancel?: () => void;
}

export interface Composer {
	form: HTMLFormElement;
	/** Takes the newest callbacks (a redraw makes new ones). */
	update(options: ComposerOptions): void;
	isEmpty(): boolean;
	hasFocus(): boolean;
	focus(): void;
	destroy(): void;
}

/** Enter sends, Escape cancels; the `@` and `[[` menus take these keys first while open. */
function keysExtension(send: () => void, cancel: () => boolean): EditorExtension {
	return {
		name: "comment-keys",
		register: ({ editor }) =>
			mergeRegister(
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						if (!event || event.isComposing) return false;
						if (event.metaKey || event.ctrlKey) {
							event.preventDefault();
							send();
							return true;
						}
						if (event.shiftKey) return false;
						// In a list, Enter makes the next item (on an empty one it leaves the list).
						const inList = editor.getEditorState().read(() => {
							const selection = $getSelection();
							return (
								$isRangeSelection(selection) &&
								$findMatchingParent(selection.anchor.getNode(), $isListItemNode) !== null
							);
						});
						if (inList) return false;
						event.preventDefault();
						send();
						return true;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerCommand(
					KEY_ESCAPE_COMMAND,
					(event) => {
						if (!cancel()) return false;
						event?.preventDefault();
						event?.stopPropagation();
						return true;
					},
					COMMAND_PRIORITY_LOW,
				),
			),
	};
}

export function composer(initial: ComposerOptions, people: () => readonly Person[]): Composer {
	let options = initial;
	const form = document.createElement("form");
	form.className = "cm-compose";
	const host = document.createElement("div");
	host.className = "cm-editor";
	const send = document.createElement("button");
	send.type = "submit";
	send.className = "cm-icon cm-send";
	send.innerHTML = icon("send", 15);
	const label = () => {
		send.title = options.label;
		send.setAttribute("aria-label", options.label);
	};
	label();
	form.append(host, send);

	let handle: EditorHandle | null = null;
	const text = () => (handle ? toCommentMarkdown(handle.getJSON()) : "");
	const sync = () => {
		send.disabled = text() === "";
	};

	handle = mountEditor(host, {
		namespace: "comment",
		label: initial.label,
		state: initial.value ? commentState(initial.value) : undefined,
		extensions: [
			richTextExtension(),
			historyExtension(),
			listExtension(),
			markdownExtension(),
			linkExtension(),
			pageLinkExtension({ directory: pageDirectory, href: pageHref, parseUrl: pageIdFromUrl }),
			pagePickerExtension({ directory: pageDirectory }),
			mentionExtension({ people }),
			placeholderExtension({ line: initial.placeholder, empty: initial.placeholder }),
			keysExtension(
				() => form.requestSubmit(),
				() => {
					if (!options.onCancel) return false;
					options.onCancel();
					return true;
				},
			),
		],
		onChange: sync,
	});
	queueMicrotask(sync);

	const clear = () =>
		handle?.editor.update(
			() => {
				const root = $getRoot();
				root.clear();
				root.append($createParagraphNode());
			},
			{ discrete: true },
		);

	let busy = false;
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const markdown = text();
		if (!markdown || busy || !handle) return;
		if (markdown.length > MAX_BODY) return;
		busy = true;
		send.disabled = true;
		const before = handle.getJSON();
		clear();
		void options.onSend(markdown).then((ok) => {
			busy = false;
			// Put it back if it didn't go, unless something new was typed since.
			if (!ok && handle && text() === "")
				handle.editor.setEditorState(handle.editor.parseEditorState(before));
			sync();
		});
	});

	return {
		form,
		update(next) {
			options = next;
			label();
		},
		isEmpty: () => text() === "",
		hasFocus: () => host.contains(document.activeElement),
		focus: () => handle?.focus(),
		destroy() {
			handle?.destroy();
			handle = null;
			form.remove();
		},
	};
}
