import { mergeRegister } from "@lexical/utils";
import { COMMAND_PRIORITY_EDITOR, createCommand } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { $anchorBlock } from "../../shared/blocks.ts";
import { registerSelectedClass } from "../../shared/click-select.ts";
import { listen } from "../../shared/dom.ts";
import { $insertDatabase, $removeDatabase, $restoreDatabase } from "./logic.ts";
import { $isDatabaseNode, DatabaseNode, setDatabaseElement } from "./node.ts";

export { $createDatabaseNode, $isDatabaseNode, DatabaseNode } from "./node.ts";

/** Creates a database (through the app) and puts it at the cursor. */
export const INSERT_DATABASE_COMMAND = createCommand<void>("INSERT_DATABASE_COMMAND");

export interface DatabaseOptions {
	/** The custom element that shows a database (given its id as `data-id`). */
	element: string;
	/** Makes a new database; its id, or null when that failed (the app says why). */
	create: () => Promise<string | null>;
	/**
	 * A DOM event (bubbling to the editor's host, `detail.id` the database)
	 * that says a database was deleted: its blocks are removed.
	 */
	deletedEvent?: string;
	/** After a deletion's blocks are removed; `restore` puts them back (an Undo). */
	onDeleted?: (event: CustomEvent<{ id: string }>, restore: () => void) => void;
}

/** Inline databases: blocks that show the app's database element. */
export function databaseExtension(options: DatabaseOptions): EditorExtension {
	return {
		name: "database",
		nodes: [DatabaseNode],
		items: [
			{
				id: "database",
				label: "Database",
				hint: "Table of pages with properties",
				keywords: "database table inline data rows properties",
				order: 250,
				hiddenIn: ["table"],
				apply: (e) => e.dispatchCommand(INSERT_DATABASE_COMMAND, undefined),
			},
		],
		register({ editor, host }) {
			setDatabaseElement(options.element);

			let creating = false;
			const insert = async (blockKey: string | null) => {
				if (creating) return;
				creating = true;
				try {
					const id = await options.create();
					if (id) editor.update(() => $insertDatabase(id, blockKey));
				} finally {
					creating = false;
				}
			};

			const onDeleted = (event: CustomEvent<{ id: string }>) => {
				const { id } = event.detail;
				let spot: ReturnType<typeof $removeDatabase> = null;
				editor.update(() => {
					spot = $removeDatabase(id);
				});
				options.onDeleted?.(event, () => editor.update(() => $restoreDatabase(id, spot)));
			};

			return mergeRegister(
				editor.registerCommand(
					INSERT_DATABASE_COMMAND,
					() => {
						void insert($anchorBlock()?.getKey() ?? null);
						return true;
					},
					COMMAND_PRIORITY_EDITOR,
				),
				// Show when the block itself is selected (Backspace next to it selects it first).
				registerSelectedClass(editor, $isDatabaseNode, "is-selected"),
				options.deletedEvent ? listen(host, options.deletedEvent, onDeleted) : () => {},
			);
		},
	};
}
