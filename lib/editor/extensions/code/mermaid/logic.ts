/**
 * Mermaid diagrams in code blocks. A code block in the Mermaid language shows
 * its diagram as Code (source only), Preview (diagram only) or Split (source
 * with the diagram below), saved on the block.
 */
import { $createCodeNode, $isCodeNode, type CodeNode } from "@lexical/code";
import {
	$createTextNode,
	$getNodeByKey,
	$getState,
	$setState,
	createState,
	type LexicalNode,
	type NodeKey,
} from "lexical";

import { $anchorBlock, $ensureLineAfter, $replaceOrInsertAfter } from "../../../shared/blocks.ts";
import { resolveLanguage } from "../languages.ts";

export type MermaidView = "code" | "preview" | "split";
const VIEWS: MermaidView[] = ["code", "preview", "split"];

/** The block's view, stored with it (`$` in its JSON). Split unless chosen. */
export const mermaidViewState = createState("mermaidView", {
	parse: (value): MermaidView =>
		VIEWS.includes(value as MermaidView) ? (value as MermaidView) : "split",
});

export function $isMermaidBlock(node: LexicalNode | null | undefined): node is CodeNode {
	return $isCodeNode(node) && resolveLanguage(node.getLanguage()) === "mermaid";
}

export function $getMermaidView(node: CodeNode): MermaidView {
	return $getState(node, mermaidViewState);
}

/** Sets a Mermaid block's view. */
export function $chooseMermaidView(key: NodeKey, view: MermaidView): void {
	const node = $getNodeByKey(key);
	if ($isMermaidBlock(node)) $setState(node, mermaidViewState, view);
}

/** A diagram to start from (`/mermaid`). */
export const MERMAID_STARTER = `flowchart TD
  A[Start] --> B{Is it working?}
  B -->|Yes| C[Great]
  B -->|No| D[Check the syntax]
  D --> B`;

/** A Mermaid code block with a starter diagram, replacing the line if it's empty. */
export function $insertMermaid(): void {
	const block = $anchorBlock();
	if (!block) return;
	const code = $createCodeNode("mermaid");
	code.append($createTextNode(MERMAID_STARTER));
	$replaceOrInsertAfter(block, code);
	$ensureLineAfter(code);
	code.selectEnd();
}

/**
 * A Mermaid error in one line: "Parse error on line 6: unexpected end of the
 * diagram" rather than its parser trace and list of expected tokens.
 */
export function mermaidMessage(error: unknown, source: string): string {
	const text = error instanceof Error ? error.message : String(error);
	const lines = text.split("\n").map((line) => line.trim());
	// An error at the end is reported on the line after the last one; say the last.
	const last = Math.max(1, source.replace(/\s+$/, "").split("\n").length);
	const first = (lines.find(Boolean) ?? "Invalid diagram")
		.replace(/:$/, "")
		.replace(/\bline (\d+)/, (_, n: string) => `line ${Math.min(Number(n), last)}`);
	const got = lines.find((line) => line.startsWith("Expecting"))?.match(/got '([^']+)'\s*$/)?.[1];
	const detail = got
		? got === "EOF"
			? "unexpected end of the diagram"
			: `unexpected ${got.toLowerCase().replace(/_/g, " ")}`
		: "";
	return `${first}${detail ? `: ${detail}` : ""}`.slice(0, 200);
}
