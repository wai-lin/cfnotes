import { mergeRegister } from "@lexical/utils";
import {
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	COMMAND_PRIORITY_EDITOR,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_NORMAL,
	createCommand,
	KEY_DOWN_COMMAND,
	KEY_ENTER_COMMAND,
	type NodeKey,
} from "lexical";

import { ranked, type EditorExtension } from "../../core/extension";
import { createStore } from "../../core/store";
import { registerClickSelect } from "../../shared/click-select";
import { listen, onPointerOutside } from "../../shared/dom";
import {
	$finishEquation,
	$insertEquation,
	$selectedEquationKey,
	BLOCK_EQUATION_TRANSFORMER,
	INLINE_EQUATION_TRANSFORMER,
	takePendingOpen,
} from "./logic";
import { $isEquationNode, EquationNode, MAX_EQUATION } from "./node";
import { createEquationEditorView, drawEquation, type EquationTarget } from "./view";

export { BLOCK_EQUATION_TRANSFORMER, INLINE_EQUATION_TRANSFORMER } from "./logic";
export * from "./node";

/** Inserts an equation at the cursor (inline) or as a block, and opens its editor. */
export const INSERT_EQUATION_COMMAND = createCommand<{ inline: boolean }>(
	"INSERT_EQUATION_COMMAND",
);

/**
 * TeX equations (KaTeX, loaded the first time a page shows one): `/equation`,
 * `$$…$$` in a line, `$$ ` at a line's start, ⌘⇧E or the toolbar's √.
 * Clicking one (or Enter on a selected one) edits it.
 */
export function equationExtension(): EditorExtension {
	return {
		name: "equation",
		nodes: [EquationNode],
		// Before the text formats, so `$$x$$` isn't read as text.
		markdown: ranked(80, BLOCK_EQUATION_TRANSFORMER, INLINE_EQUATION_TRANSFORMER),
		items: [
			{
				id: "equation",
				label: "Block equation",
				hint: "Display a TeX equation",
				keywords: "equation math tex latex katex formula block",
				order: 160,
				hiddenIn: ["table"],
				apply: (e) => e.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: false }),
			},
			{
				id: "inline-equation",
				label: "Inline equation",
				hint: "A TeX equation inside the line",
				keywords: "equation math tex latex katex formula inline",
				order: 170,
				apply: (e) => e.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true }),
			},
		],
		toolbar: [
			{
				id: "equation",
				icon: "squareRoot",
				label: "Inline equation",
				title: "Inline equation (⌘⇧E)",
				className: "fmt-math",
				order: 70,
				run: (editor) => editor.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true }),
			},
		],
		register({ editor, host }) {
			const store = createStore<{ open: (EquationTarget & { key: NodeKey }) | null }>({
				open: null,
			});

			/** Closes the editor, saving what was typed (`commit`) or putting it back. */
			const close = (commit: boolean) => {
				const { open } = store.get();
				if (!open) return;
				const value = commit ? view.value().trim() : open.original;
				store.set({ open: null });
				drawEquation(open.wrap, value, !open.inline); // what the reader saw while typing may differ
				editor.update(() => $finishEquation(open.key, value, commit), {
					// Back to the page, keeping the selection just made (a block's ring).
					onUpdate: () => editor.getRootElement()?.focus({ preventScroll: true }),
				});
			};

			const openEditor = (key: NodeKey) => {
				if (store.get().open) close(true);
				const wrap = editor.getElementByKey(key);
				const node = editor.read(() => $getNodeByKey(key));
				if (!wrap || !$isEquationNode(node)) return;
				store.set({ open: { key, inline: node.__inline, original: node.__equation, wrap } });
			};

			const view = createEquationEditorView({
				maxLength: MAX_EQUATION,
				onDone: () => close(true),
				onCancel: () => close(false),
			});
			const offRender = store.subscribe(({ open }) => view.render(open));

			// Clicking an equation opens it.
			const onClick = (event: MouseEvent) => {
				const wrap = (event.target as Element).closest<HTMLElement>(".ne-eq");
				if (!wrap || !editor.getRootElement()?.contains(wrap)) return;
				event.preventDefault();
				const key = editor.read(() => {
					const node = $getNearestNodeFromDOMNode(wrap);
					return $isEquationNode(node) ? node.getKey() : null;
				});
				if (key) openEditor(key);
			};

			return mergeRegister(
				// A block equation can be selected (and deleted with Backspace) like an image.
				registerClickSelect(editor, host, ".ne-eq-block", $isEquationNode),
				editor.registerCommand(
					INSERT_EQUATION_COMMAND,
					({ inline }) => $insertEquation(inline),
					COMMAND_PRIORITY_EDITOR,
				),
				// Open an equation made by the command or the `$$ ` shortcut once it's drawn.
				editor.registerUpdateListener(() => {
					const key = takePendingOpen();
					if (key) requestAnimationFrame(() => openEditor(key));
				}),
				// Enter on a selected equation edits it.
				editor.registerCommand(
					KEY_ENTER_COMMAND,
					(event) => {
						const key = $selectedEquationKey();
						if (!key) return false;
						event?.preventDefault();
						queueMicrotask(() => openEditor(key));
						return true;
					},
					COMMAND_PRIORITY_HIGH,
				),
				// ⌘⇧E: an inline equation (from the selected text, if any).
				editor.registerCommand(
					KEY_DOWN_COMMAND,
					(event: KeyboardEvent) => {
						if (!(event.metaKey || event.ctrlKey) || event.altKey || !event.shiftKey) return false;
						if (event.code !== "KeyE") return false;
						event.preventDefault();
						return editor.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true });
					},
					COMMAND_PRIORITY_NORMAL,
				),
				onPointerOutside(
					() => [view.element],
					() => close(true),
				),
				listen(window, "resize", () => view.place()),
				listen(document, "click", onClick),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
