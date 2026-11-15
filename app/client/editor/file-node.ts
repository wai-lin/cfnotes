import { mergeRegister } from "@lexical/utils";
import { icon } from "@modules/icons";
import {
	$getNearestNodeFromDOMNode,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	DecoratorNode,
	DROP_COMMAND,
	PASTE_COMMAND,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { $insertBlocks, $selectedBlockKey, registerClickSelect } from "./block-ops";
import { $createImageNode } from "./image-node";
import { upload } from "./uploads";

export type SerializedFileNode = Spread<
	{ src: string; name: string; size: number },
	SerializedLexicalNode
>;

function formatSize(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** A non-image attachment: a row with the file's name, size and a download link. */
export class FileNode extends DecoratorNode<null> {
	__src: string;
	__name: string;
	__size: number;

	static override getType(): string {
		return "file";
	}

	static override clone(node: FileNode): FileNode {
		return new FileNode(node.__src, node.__name, node.__size, node.__key);
	}

	static override importJSON(json: SerializedFileNode): FileNode {
		return $createFileNode(json.src, json.name, json.size).updateFromJSON(json);
	}

	constructor(src: string, name: string, size: number, key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__name = name;
		this.__size = size;
	}

	override exportJSON(): SerializedFileNode {
		return { ...super.exportJSON(), src: this.__src, name: this.__name, size: this.__size };
	}

	override createDOM(): HTMLElement {
		const row = document.createElement("div");
		row.className = "ne-file";
		row.contentEditable = "false";
		const clip = document.createElement("span");
		clip.className = "ne-file-icon";
		clip.innerHTML = icon("paperclip", 18);
		const name = document.createElement("span");
		name.className = "ne-file-name";
		name.textContent = this.__name || "Untitled file";
		const size = document.createElement("span");
		size.className = "ne-file-size";
		size.textContent = formatSize(this.__size);
		const link = document.createElement("a");
		link.className = "ne-file-dl";
		link.href = `${this.__src}?name=${encodeURIComponent(this.__name)}`;
		link.innerHTML = icon("download", 16);
		link.title = "Download";
		link.setAttribute("aria-label", `Download ${this.__name}`);
		row.append(clip, name, size, link);
		return row;
	}

	override updateDOM(): boolean {
		return false;
	}

	override isInline(): boolean {
		return false;
	}

	override decorate(): null {
		return null;
	}
}

export function $createFileNode(src: string, name: string, size: number): FileNode {
	return new FileNode(src, name, size);
}

export function $isFileNode(node: LexicalNode | null | undefined): node is FileNode {
	return node instanceof FileNode;
}

/** Opens the file picker and attaches the chosen files at the cursor. */
export const INSERT_FILE_COMMAND = createCommand<void>("INSERT_FILE_COMMAND");

/**
 * Uploads for the editor: the `/file` picker, and paste/drop of any files.
 * Images become image blocks, everything else an attachment row.
 */
export function registerFiles(editor: LexicalEditor, host: HTMLElement): () => void {
	const input = document.createElement("input");
	input.type = "file";
	input.multiple = true;
	input.hidden = true;
	input.className = "ne-file-input";
	host.append(input);

	const uploadAll = async (files: File[], blockKey: NodeKey | null) => {
		const results = (await Promise.all(files.map(upload))).filter((x) => x !== null);
		const nodes = () =>
			results.map((item) =>
				item.kind === "image"
					? $createImageNode(item.src, item.alt)
					: $createFileNode(item.src, item.name, item.size),
			);
		if (results.length > 0) editor.update(() => $insertBlocks(nodes(), blockKey));
	};

	let pickAt: NodeKey | null = null;
	input.addEventListener("change", () => {
		const files = [...(input.files ?? [])];
		input.value = "";
		void uploadAll(files, pickAt);
	});

	return mergeRegister(
		editor.registerCommand(
			INSERT_FILE_COMMAND,
			() => {
				pickAt = $selectedBlockKey();
				input.click();
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
		() => input.remove(),
	);
}
