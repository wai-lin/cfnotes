import {
	INSERT_CHECK_LIST_COMMAND,
	INSERT_ORDERED_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
	ListItemNode,
	ListNode,
	registerCheckList,
	registerList,
} from "@lexical/list";
import { CHECK_LIST, ORDERED_LIST, UNORDERED_LIST } from "@lexical/markdown";
import { mergeRegister } from "@lexical/utils";

import { ranked, type EditorExtension } from "../../core/extension";

/** Bulleted, numbered and to-do lists. */
export function listExtension(): EditorExtension {
	return {
		name: "list",
		nodes: [ListNode, ListItemNode],
		// `- [ ]` is a to-do before it's a bullet.
		markdown: [...ranked(90, CHECK_LIST), ...ranked(40, UNORDERED_LIST, ORDERED_LIST)],
		convertible: ["list"],
		items: [
			{
				id: "bullet",
				label: "Bulleted list",
				hint: "Simple bulleted list",
				keywords: "ul bullet list unordered",
				order: 50,
				turnInto: true,
				apply: (e) => e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
			},
			{
				id: "number",
				label: "Numbered list",
				hint: "List with numbering",
				keywords: "ol numbered list ordered",
				order: 60,
				turnInto: true,
				apply: (e) => e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
			},
			{
				id: "todo",
				label: "To-do list",
				hint: "Track tasks with checkboxes",
				keywords: "todo task check checkbox list",
				order: 70,
				turnInto: true,
				apply: (e) => e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
			},
		],
		register: ({ editor }) => mergeRegister(registerList(editor), registerCheckList(editor)),
	};
}
