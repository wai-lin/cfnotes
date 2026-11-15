import { CodeNode } from "@lexical/code";
import type { LexicalEditor } from "lexical";

/**
 * Loads Shiki the first time the document has a code block, so pages without
 * code never download it. Registering Lexical transforms marks existing nodes
 * dirty, so blocks that are already on the page get highlighted on arrival.
 */
export function registerLazyHighlighting(editor: LexicalEditor): () => void {
	let disposed = false;
	let started = false;
	let unregister: (() => void) | undefined;

	const offMutations = editor.registerMutationListener(
		CodeNode,
		(mutations) => {
			if (started || ![...mutations.values()].includes("created")) return;
			started = true;
			import("./code-highlight")
				.then(({ registerShikiHighlighting }) => {
					if (!disposed) unregister = registerShikiHighlighting(editor);
				})
				.catch((error: unknown) => {
					started = false; // try again on the next code block
					console.error("[notes-editor] could not load syntax highlighting", error);
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
