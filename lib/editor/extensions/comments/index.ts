import {
	$isMarkNode,
	$unwrapMarkNode,
	$wrapSelectionInMarkNode,
	$createMarkNode,
	MarkNode,
} from "@lexical/mark";
import {
	$dfs,
	$findMatchingParent,
	mergeRegister,
	registerNestedElementResolver,
} from "@lexical/utils";
import { $getSelection, $isRangeSelection, type LexicalEditor } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";

/** What the app can do to the marked text. */
export interface CommentMarks {
	/** Highlights the text of the `open` threads; `active` the most. */
	highlight(open: ReadonlySet<string>, active?: string | null): void;
	/** Takes a thread's marks off the text. */
	remove(id: string): void;
	/** A thread's text: its first element, or `null` when the text is gone. */
	find(id: string): HTMLElement | null;
	/** Scrolls to a thread's text; its first element, or `null` when the text is gone. */
	reveal(id: string): HTMLElement | null;
	/** The threads whose text is on the page. */
	present(): Set<string>;
}

export interface CommentsOptions {
	/** The selected text was just marked for a new thread `id`: ask for its first comment. */
	onStart(id: string, quote: string, mark: HTMLElement): void;
	/** Highlighted text was clicked: the highlighted threads on it. */
	onOpen(ids: string[], mark: HTMLElement): void;
	/** Hands over the marks' controls once the editor is up, and `null` when it goes. */
	connect(marks: CommentMarks | null): void;
	/** The threads with text on the page changed (text was typed over, deleted or undone). */
	onPresent?(ids: Set<string>): void;
}

const ATTR = "data-comment-ids";

/** The ids of the threads a mark element is for. */
const idsOf = (element: Element) => (element.getAttribute(ATTR) ?? "").split(" ").filter(Boolean);

/**
 * Comments on text (Notion's): "Comment" on the selection toolbar marks the
 * selected text with a new thread's id and asks the app for the first
 * comment. Threads live in the app; the document only keeps the marks, so a
 * resolved thread's text just stops being highlighted.
 */
export function commentsExtension(options: CommentsOptions): EditorExtension {
	/** Marks for a thread, with their ids on them. */
	const elementsFor = (editor: LexicalEditor, id: string) =>
		[...(editor.getRootElement()?.querySelectorAll<HTMLElement>(`mark[${ATTR}]`) ?? [])].filter(
			(element) => idsOf(element).includes(id),
		);

	return {
		name: "comments",
		nodes: [MarkNode],
		toolbar: [
			{
				id: "comment",
				icon: "messagePlus",
				label: "Comment",
				title: "Comment on the selected text",
				className: "fmt-comment",
				order: 80,
				run(editor) {
					let made: { id: string; quote: string } | null = null;
					editor.update(
						() => {
							const selection = $getSelection();
							if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
							// Code is made of its own nodes: a mark would break it.
							const inCode = [selection.anchor, selection.focus].some((point) =>
								$findMatchingParent(point.getNode(), (n) => n.getType() === "code"),
							);
							const quote = selection.getTextContent();
							if (inCode || quote.trim() === "") return;
							const id = crypto.randomUUID();
							$wrapSelectionInMarkNode(selection, selection.isBackward(), id);
							made = { id, quote };
						},
						{ discrete: true },
					);
					const started = made as { id: string; quote: string } | null;
					if (!started) return;
					const [mark] = elementsFor(editor, started.id);
					if (mark) options.onStart(started.id, started.quote, mark);
				},
			},
		],
		register({ editor }) {
			let open: ReadonlySet<string> = new Set();
			let active: string | null = null;
			let present = new Set<string>();

			/** Puts the ids on every mark element and lights those of open threads. */
			const paint = () => {
				const marks = editor.getEditorState().read(() => {
					const found: [string, string[]][] = [];
					for (const { node } of $dfs())
						if ($isMarkNode(node)) found.push([node.getKey(), node.getIDs()]);
					return found;
				});
				const ids = new Set<string>();
				for (const [key, list] of marks) {
					for (const id of list) ids.add(id);
					const element = editor.getElementByKey(key);
					if (!element) continue;
					element.setAttribute(ATTR, list.join(" "));
					element.classList.toggle(
						"is-open",
						list.some((id) => open.has(id)),
					);
					element.classList.toggle("is-active", active !== null && list.includes(active));
				}
				const changed = ids.size !== present.size || [...ids].some((id) => !present.has(id));
				present = ids;
				if (changed) options.onPresent?.(new Set(ids));
			};

			const marks: CommentMarks = {
				highlight(next, nextActive = null) {
					open = next;
					active = nextActive;
					paint();
				},
				remove(id) {
					editor.update(() => {
						for (const { node } of $dfs()) {
							if (!$isMarkNode(node) || !node.hasID(id)) continue;
							node.deleteID(id);
							if (node.getIDs().length === 0) $unwrapMarkNode(node);
						}
					});
				},
				find: (id) => elementsFor(editor, id)[0] ?? null,
				reveal(id) {
					const [first] = elementsFor(editor, id);
					first?.scrollIntoView({ block: "center", behavior: "smooth" });
					return first ?? null;
				},
				present: () => new Set(present),
			};

			const onClick = (event: MouseEvent) => {
				const mark = (event.target as Element).closest?.<HTMLElement>(`mark[${ATTR}]`);
				if (!mark || !editor.getRootElement()?.contains(mark)) return;
				const ids = idsOf(mark).filter((id) => open.has(id));
				// Not while selecting text by dragging over it.
				if (ids.length > 0 && getSelection()?.isCollapsed !== false) options.onOpen(ids, mark);
			};

			options.connect(marks);
			paint();
			return mergeRegister(
				editor.registerUpdateListener(paint),
				// A mark made over another one: the text in both carries both ids.
				registerNestedElementResolver<MarkNode>(
					editor,
					MarkNode,
					(from) => $createMarkNode(from.getIDs()),
					(from, to) => {
						for (const id of from.getIDs()) to.addID(id);
					},
				),
				editor.registerRootListener((root, prev) => {
					prev?.removeEventListener("click", onClick);
					root?.addEventListener("click", onClick);
				}),
				() => options.connect(null),
			);
		},
	};
}
