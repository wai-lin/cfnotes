import { mergeRegister } from "@lexical/utils";
import {
	$getNearestNodeFromDOMNode,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	DROP_COMMAND,
	PASTE_COMMAND,
	type NodeKey,
} from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { $insertBlocks, $selectedBlockKey } from "../../shared/blocks.ts";
import { registerClickSelect } from "../../shared/click-select.ts";
import { createFilePicker } from "../../shared/file-picker.ts";
import type { Uploader } from "../../shared/upload.ts";
import { $nodeForUpload } from "./logic.ts";
import { $isFileNode, FileNode } from "./node.ts";

export { formatSize } from "./format.ts";
export { $createFileNode, $isFileNode, FileNode } from "./node.ts";

/** Opens the file picker and attaches the chosen files at the cursor. */
export const INSERT_FILE_COMMAND = createCommand<void>("INSERT_FILE_COMMAND");

/**
 * Attachments, and uploads of any kind: the `/file` picker, and pasting or
 * dropping files. Images become image blocks (needs the image extension),
 * everything else an attachment row.
 */
export function fileExtension({ upload }: { upload: Uploader }): EditorExtension {
	return {
		name: "file",
		nodes: [FileNode],
		items: [
			{
				id: "file",
				label: "File",
				hint: "Upload a file to download later",
				keywords: "file attachment upload pdf document attach",
				order: 120,
				hiddenIn: ["table"],
				apply: (e) => e.dispatchCommand(INSERT_FILE_COMMAND, undefined),
			},
		],
		register({ editor, host }) {
			const uploadAll = async (files: File[], blockKey: NodeKey | null) => {
				const results = (await Promise.all(files.map(upload))).filter((x) => x !== null);
				if (results.length > 0)
					editor.update(() => $insertBlocks(results.map($nodeForUpload), blockKey));
			};
			const picker = createFilePicker(
				host,
				"ne-file-input",
				null,
				(files, at) => void uploadAll(files, at),
			);

			return mergeRegister(
				editor.registerCommand(
					INSERT_FILE_COMMAND,
					() => {
						picker.pick($selectedBlockKey());
						return true;
					},
					COMMAND_PRIORITY_EDITOR,
				),
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						if (!(event instanceof ClipboardEvent)) return false;
						const files = [...(event.clipboardData?.files ?? [])];
						if (files.length === 0) return false;
						event.preventDefault();
						void uploadAll(files, null);
						return true;
					},
					COMMAND_PRIORITY_CRITICAL,
				),
				editor.registerCommand(
					DROP_COMMAND,
					(event) => {
						const files = [...(event.dataTransfer?.files ?? [])];
						if (files.length === 0) return false;
						event.preventDefault();
						// Drop where the pointer is: the block under the drop point.
						const at = document.elementFromPoint(event.clientX, event.clientY);
						const block = at?.closest(".ne-content > *") ?? null;
						const key = block
							? editor.read(
									() => $getNearestNodeFromDOMNode(block)?.getTopLevelElement()?.getKey() ?? null,
								)
							: null;
						void uploadAll(files, key);
						return true;
					},
					COMMAND_PRIORITY_CRITICAL,
				),
				registerClickSelect(editor, host, ".ne-file", $isFileNode),
				picker.destroy,
			);
		},
	};
}
