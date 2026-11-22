import { $isCodeNode, CodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";

import { listen, onPointerOutside } from "../../../shared/dom.ts";
import { languageName, PLAIN_TEXT, resolveLanguage } from "../languages.ts";
import { $chooseMermaidView, $getMermaidView, $isMermaidBlock } from "../mermaid/logic.ts";
import { createCodeToolbarStore, type CodeBlockInfo } from "./state.ts";
import { createCodeToolbarView } from "./view.ts";

/**
 * A language picker and Copy button on every code block, and with `mermaid`,
 * a Code / Preview / Split switch on Mermaid blocks. `host` must be positioned.
 */
export function registerCodeToolbar(
	editor: LexicalEditor,
	host: HTMLElement,
	{ mermaid }: { mermaid: boolean },
): () => void {
	const store = createCodeToolbarStore();
	/** Code blocks on the page. */
	const keys = new Set<NodeKey>();

	const readBlocks = (): CodeBlockInfo[] =>
		editor.read(() =>
			[...keys].flatMap((key) => {
				const node = $getNodeByKey(key);
				if (!$isCodeNode(node)) return [];
				const language = node.getLanguage();
				return [
					{
						key,
						language: languageName(language),
						languageId: resolveLanguage(language) ?? PLAIN_TEXT,
						view: mermaid && $isMermaidBlock(node) ? $getMermaidView(node) : null,
					},
				];
			}),
		);

	const closeMenu = (refocus: boolean) => {
		if (store.get().menuKey === null) return;
		store.set({ menuKey: null });
		if (refocus) editor.focus();
	};

	const refresh = () => {
		const blocks = readBlocks();
		const { menuKey } = store.get();
		if (menuKey && !keys.has(menuKey)) closeMenu(false);
		store.set({ blocks });
	};

	const view = createCodeToolbarView({
		host,
		blockElement: (key) => editor.getElementByKey(key),
		onToggleMenu: (key) => {
			if (store.get().menuKey === key) closeMenu(true);
			else store.set({ menuKey: key });
		},
		onCopy: (key) => {
			const text = editor.read(() => $getNodeByKey(key)?.getTextContent() ?? "");
			void navigator.clipboard.writeText(text).then(() => view.flashCopied(key));
		},
		onView: (key, choice) => editor.update(() => $chooseMermaidView(key, choice)),
		onLanguage: (key, language) => {
			editor.update(() => {
				const node = $getNodeByKey(key);
				if ($isCodeNode(node)) node.setLanguage(language);
			});
			closeMenu(true);
		},
		onCloseMenu: closeMenu,
	});
	const offRender = store.subscribe((state, prev) => view.render(state, prev));

	const resizes = new ResizeObserver(() => view.layout());
	resizes.observe(host);

	return mergeRegister(
		editor.registerMutationListener(
			CodeNode,
			(mutations) => {
				for (const [key, mutation] of mutations) {
					if (mutation === "destroyed") keys.delete(key);
					else keys.add(key);
				}
				refresh();
			},
			{ skipInitialization: false },
		),
		// Edits anywhere can move a block (and change its label), so lay out after each one.
		editor.registerUpdateListener(refresh),
		onPointerOutside(
			() => [],
			(event) => {
				if (store.get().menuKey && !view.ownsPress(event.target as Node)) closeMenu(false);
			},
		),
		listen(window, "resize", () => view.layout()),
		listen(window, "scroll", () => view.layout(), true),
		() => resizes.disconnect(),
		offRender,
		() => view.destroy(),
	);
}
