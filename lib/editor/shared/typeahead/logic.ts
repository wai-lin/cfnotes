import { $isCodeNode } from "@lexical/code";
import { $findMatchingParent } from "@lexical/utils";
import {
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	type LexicalNode,
	type NodeKey,
} from "lexical";

/** Text typed after a trigger (`/`, `[[`) right before the caret. */
export interface TriggerMatch {
	/** The text node it's in, and where the trigger starts and the query ends. */
	key: NodeKey;
	start: number;
	end: number;
	query: string;
	/** The containers (by name) the caret is inside. */
	containers: string[];
}

export interface Trigger {
	/** Matches the text before the caret; group 1 is the query. */
	pattern: RegExp;
	/** The trigger itself (`/`), which comes right before the query. */
	prefix: string;
}

/**
 * The trigger before a collapsed caret in plain text (not in code blocks), if
 * any. Call inside `editor.read`.
 */
export function $findTrigger(
	trigger: Trigger,
	containers: { name: string; test: (node: LexicalNode) => boolean }[] = [],
): TriggerMatch | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
	const node = selection.anchor.getNode();
	if (!$isTextNode(node) || $isCodeNode(node.getTopLevelElement())) return null;
	const found = trigger.pattern.exec(node.getTextContent().slice(0, selection.anchor.offset));
	if (!found) return null;
	const query = found[1] ?? "";
	return {
		key: node.getKey(),
		start: selection.anchor.offset - query.length - trigger.prefix.length,
		end: selection.anchor.offset,
		query,
		containers: containers
			.filter((container) => $findMatchingParent(node, container.test) !== null)
			.map((container) => container.name),
	};
}

/**
 * Removes the trigger and query text. With `check`, only if it's still there
 * as typed. Call inside `editor.update`.
 */
export function $removeTrigger(match: TriggerMatch, prefix: string, check = false): void {
	const node = $getNodeByKey(match.key);
	if (!$isTextNode(node)) return;
	if (check && node.getTextContent().slice(match.start, match.end) !== prefix + match.query) return;
	node.spliceText(match.start, match.end - match.start, "", true);
}

/** Where a match is, to remember that Escape dismissed it. */
export const matchId = (match: TriggerMatch) => `${match.key}:${match.start}`;
