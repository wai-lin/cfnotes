import { mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$isParagraphNode,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

import type { EditorExtension } from "../../core/extension";
import { $insertBlocks, $selectedBlockKey } from "../../shared/blocks";
import { registerClickSelect } from "../../shared/click-select";
import { createFilePicker } from "../../shared/file-picker";
import { IMAGE_TYPES, type Uploaded, type Uploader } from "../../shared/upload";
import { $createImageNode, $isImageNode, ImageNode, setLocalImageSource } from "./node";

export { $createImageNode, $isImageNode, ImageNode } from "./node";

/** Opens the file picker and inserts the chosen images at the cursor. */
export const INSERT_IMAGE_COMMAND = createCommand<void>("INSERT_IMAGE_COMMAND");

export interface ImageOptions {
	upload: Uploader;
	/** Image paths of the app's own that pasted HTML may keep (web images always may). */
	localSource?: (src: string) => boolean;
}

/** Uploads `files` and puts the images among them after `blockKey`. */
async function insertImages(
	editor: LexicalEditor,
	upload: Uploader,
	files: File[],
	blockKey: NodeKey | null,
) {
	const images = (await Promise.all(files.map(upload))).filter(
		(x): x is Extract<Uploaded, { kind: "image" }> => x?.kind === "image",
	);
	if (images.length === 0) return;
	editor.update(() =>
		$insertBlocks(
			images.map((image) => $createImageNode(image.src, image.alt)),
			blockKey,
		),
	);
}

/** Image blocks: upload from `/image`, resize from the corner, add a caption. */
export function imageExtension(options: ImageOptions): EditorExtension {
	return {
		name: "image",
		nodes: [ImageNode],
		items: [
			{
				id: "image",
				label: "Image",
				hint: "Upload an image",
				keywords: "image picture photo upload file media",
				order: 110,
				hiddenIn: ["table"],
				apply: (e) => e.dispatchCommand(INSERT_IMAGE_COMMAND, undefined),
			},
		],
		register({ editor, host }) {
			if (options.localSource) setLocalImageSource(options.localSource);
			const picker = createFilePicker(
				host,
				"ne-image-input",
				IMAGE_TYPES.join(","),
				(files, at) =>
					void insertImages(
						editor,
						options.upload,
						files.filter((f) => IMAGE_TYPES.includes(f.type)),
						at,
					),
			);

			return mergeRegister(
				editor.registerCommand(
					INSERT_IMAGE_COMMAND,
					() => {
						picker.pick($selectedBlockKey());
						return true;
					},
					COMMAND_PRIORITY_EDITOR,
				),
				// Clicking an image selects its block (so Backspace deletes it).
				registerClickSelect(editor, host, ".ne-image", $isImageNode),
				// An image is a block: one pasted inside a line splits the line around it.
				editor.registerNodeTransform(ImageNode, (node) => {
					const parent = node.getParent();
					if (!$isParagraphNode(parent)) return;
					const after = node.getNextSiblings();
					parent.insertAfter(node);
					if (after.length > 0) {
						const rest = $createParagraphNode();
						rest.append(...after);
						node.insertAfter(rest);
					}
					if (parent.isEmpty()) parent.remove();
				}),
				picker.destroy,
			);
		},
	};
}
