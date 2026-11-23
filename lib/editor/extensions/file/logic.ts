import type { LexicalNode } from "lexical";

import type { Uploaded } from "../../shared/upload.ts";
import { $createImageNode } from "../image/node.ts";
import { $createMediaNode } from "../media/node.ts";
import { $createFileNode } from "./node.ts";

/** The block an upload becomes: an image, a player (or PDF viewer), or an attachment row. */
export function $nodeForUpload(item: Uploaded): LexicalNode {
	if (item.kind === "image") return $createImageNode(item.src, item.alt);
	if (item.kind === "media") return $createMediaNode(item.media, item.src, item.name, item.size);
	return $createFileNode(item.src, item.name, item.size);
}
