import { $createCodeNode, CodeHighlightNode, CodeNode } from "@lexical/code";
import { CODE } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";
import type { LexicalEditor } from "lexical";

import { ranked, type BlockItem, type EditorExtension } from "../../core/extension";
import { setBlock } from "../../shared/blocks";
import { $insertMermaid, registerMermaid } from "./mermaid";
import { registerCodeToolbar } from "./toolbar";

export { languageName, languageOptions, resolveLanguage, PLAIN_TEXT } from "./languages";
export * from "./mermaid";

export interface CodeOptions {
	/** Mermaid code blocks show their diagram (Code / Preview / Split). */
	mermaid?: boolean;
}

/**
 * Code blocks with Shiki syntax highlighting (loaded the first time a page
 * has code), a language picker and a Copy button.
 */
export function codeExtension({ mermaid = true }: CodeOptions = {}): EditorExtension {
	const items: BlockItem[] = [
		{
			id: "code",
			label: "Code",
			hint: "Code block",
			keywords: "code snippet pre",
			order: 140,
			turnInto: true,
			apply: setBlock(() => $createCodeNode()),
		},
	];
	if (mermaid)
		items.push({
			id: "mermaid",
			label: "Mermaid diagram",
			hint: "Flowcharts, sequences, Gantt… from text",
			keywords: "mermaid diagram flowchart chart graph sequence gantt class state er mindmap",
			order: 150,
			hiddenIn: ["table"],
			apply: $insertMermaid,
		});
	return {
		name: "code",
		nodes: [CodeNode, CodeHighlightNode],
		markdown: ranked(30, CODE),
		convertible: ["code"],
		items,
		register: ({ editor, host }) =>
			mergeRegister(
				registerLazyHighlighting(editor),
				registerCodeToolbar(editor, host, { mermaid }),
				mermaid ? registerMermaid(editor) : () => {},
			),
	};
}

/**
 * Loads Shiki the first time the document has a code block, so pages without
 * code never download it. Registering Lexical transforms marks existing nodes
 * dirty, so blocks that are already on the page get highlighted on arrival.
 */
function registerLazyHighlighting(editor: LexicalEditor): () => void {
	let disposed = false;
	let started = false;
	let unregister: (() => void) | undefined;

	const offMutations = editor.registerMutationListener(
		CodeNode,
		(mutations) => {
			if (started || ![...mutations.values()].includes("created")) return;
			started = true;
			import("./highlight")
				.then(({ registerShikiHighlighting }) => {
					if (!disposed) unregister = registerShikiHighlighting(editor);
				})
				.catch((error: unknown) => {
					started = false; // try again on the next code block
					console.error("[editor] could not load syntax highlighting", error);
				});
		},
		{ skipInitialization: false },
	);

	return () => {
		disposed = true;
		offMutations();
		unregister?.();
	};
}
