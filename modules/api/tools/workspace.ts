/** MCP tools for where pages live: moving them, folders, and Trash. */
import { Effect } from "effect";

import * as Organize from "../organize.ts";
import {
	boolean,
	adds,
	changes,
	object,
	pageId,
	readOnly,
	str,
	string,
	type Tool,
} from "./tool.ts";

const folderId = string("The folder's id (see list_folders).");
const parent = {
	type: ["string", "null"],
	description: "The folder to put it in; null for the top level.",
};
const nullable = (value: unknown) => (value === null ? null : str(value));

export const WORKSPACE_TOOLS: Tool[] = [
	{
		name: "move_page",
		title: "Move a page",
		description:
			"Moves a page or full-page database to another folder (or the top level), and to a place among the pages there. Rows stay in their database and inline databases in their page.",
		inputSchema: object(
			{
				page_id: pageId,
				folder_id: {
					...parent,
					description:
						"The folder it goes in; null for the top level. Unset: it stays in its folder.",
				},
				before_page_id: {
					type: ["string", "null"],
					description: "A page in that folder to put it just before; unset or null puts it last.",
				},
			},
			["page_id"],
		),
		annotations: { ...changes, destructiveHint: false, idempotentHint: true },
		write: true,
		run: (args) => Organize.movePage(args),
	},
	{
		name: "create_folder",
		title: "Create a folder",
		description: "Makes a folder, at the top level or inside another. Answers with it.",
		inputSchema: object({ name: string("The folder's name."), parent_id: parent }, ["name"]),
		annotations: adds,
		write: true,
		run: (args) => Organize.createFolder(str(args.name) ?? "", nullable(args.parent_id) ?? null),
	},
	{
		name: "update_folder",
		title: "Change a folder",
		description:
			"Renames a folder, moves it inside another (or to the top level), or locks it. Answers with it.",
		inputSchema: object(
			{
				folder_id: folderId,
				name: string("A new name."),
				parent_id: parent,
				locked: boolean(
					"Owners only: true locks it and everything in it, so the people it's shared with can read and comment but not change, move or delete anything there; false unlocks it.",
				),
			},
			["folder_id"],
		),
		annotations: { ...changes, destructiveHint: false },
		write: true,
		run: (args) =>
			Organize.updateFolder(str(args.folder_id) ?? "", {
				name: str(args.name),
				parentId: args.parent_id === undefined ? undefined : nullable(args.parent_id),
				locked: typeof args.locked === "boolean" ? args.locked : undefined,
			}),
	},
	{
		name: "delete_folder",
		title: "Delete a folder",
		description:
			"Deletes a folder. Its pages and subfolders move up into its parent (or the top level); nothing goes to Trash. People it was shared with lose that share.",
		inputSchema: object({ folder_id: folderId }, ["folder_id"]),
		annotations: changes,
		write: true,
		run: (args) => Organize.deleteFolder(str(args.folder_id) ?? ""),
	},
	{
		name: "list_trash",
		title: "List Trash",
		description:
			"Lists what's in Trash, newest first: what each thing was, when it was trashed and when it's deleted for good. Restore with restore_page.",
		inputSchema: object({}),
		annotations: readOnly,
		run: () => Effect.map(Organize.listTrash, (items) => ({ items })),
	},
	{
		name: "restore_page",
		title: "Restore from Trash",
		description:
			"Brings a page, database or row back from Trash, with the rows and inline databases that went with it. A row needs its database back first.",
		inputSchema: object({ page_id: pageId }, ["page_id"]),
		annotations: { ...adds, idempotentHint: true },
		write: true,
		run: (args) => Effect.as(Organize.restorePage(str(args.page_id) ?? ""), "Restored."),
	},
];
