import { mergeRegister } from "@lexical/utils";
import { COMMAND_PRIORITY_EDITOR, createCommand, type NodeKey } from "lexical";

import type { BlockItem, EditorExtension } from "../../core/extension.ts";
import { $insertBlocks, $selectedBlockKey } from "../../shared/blocks.ts";
import { registerClickSelect } from "../../shared/click-select.ts";
import { createFilePicker } from "../../shared/file-picker.ts";
import { MEDIA_ACCEPT, type MediaKind, type Uploader } from "../../shared/upload.ts";
import { $nodeForUpload } from "../file/logic.ts";
import { $isMediaNode, MediaNode } from "./node.ts";

export { $createMediaNode, $isMediaNode, MediaNode } from "./node.ts";

/** Opens the file picker for one kind of media. */
export const INSERT_MEDIA_COMMAND = createCommand<MediaKind>("INSERT_MEDIA_COMMAND");

const item = (
	media: MediaKind,
	label: string,
	hint: string,
	keywords: string,
	order: number,
): BlockItem => ({
	id: media === "video" ? "video-file" : media,
	label,
	hint,
	keywords,
	order,
	hiddenIn: ["table"],
	apply: (e) => e.dispatchCommand(INSERT_MEDIA_COMMAND, media),
});

/**
 * Audio, video and PDF blocks: a player, or the PDF in the page. `/video`,
 * `/audio` and `/pdf` pick a file; pasted or dropped media becomes one too
 * (through the file extension), when the app stores it as media.
 */
export function mediaExtension({ upload }: { upload: Uploader }): EditorExtension {
	return {
		name: "media",
		nodes: [MediaNode],
		items: [
			item("video", "Video", "Upload a video to play here", "video movie clip mp4 webm media", 122),
			item(
				"audio",
				"Audio",
				"Upload a recording or song",
				"audio sound music podcast mp3 media",
				123,
			),
			item("pdf", "PDF", "Show a PDF in the page", "pdf document embed view", 124),
		],
		register({ editor, host }) {
			const insert = async (files: File[], at: NodeKey | null) => {
				const results = (await Promise.all(files.map(upload))).filter((x) => x !== null);
				if (results.length > 0) editor.update(() => $insertBlocks(results.map($nodeForUpload), at));
			};
			const pickers = Object.fromEntries(
				(Object.keys(MEDIA_ACCEPT) as MediaKind[]).map((media) => [
					media,
					createFilePicker(
						host,
						`ne-media-input`,
						MEDIA_ACCEPT[media],
						(files, at) => void insert(files, at),
					),
				]),
			) as Record<MediaKind, ReturnType<typeof createFilePicker>>;
			return mergeRegister(
				editor.registerCommand(
					INSERT_MEDIA_COMMAND,
					(media) => {
						pickers[media].pick($selectedBlockKey());
						return true;
					},
					COMMAND_PRIORITY_EDITOR,
				),
				// The caption selects the block; the player and links keep their clicks.
				registerClickSelect(editor, host, ".ne-media-caption", $isMediaNode),
				...Object.values(pickers).map((p) => p.destroy),
			);
		},
	};
}
