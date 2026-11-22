import type { LexicalNode } from "lexical";

import type { Uploaded } from "../../shared/upload.ts";
import { $createImageNode } from "../image/node.ts";
import { $createFileNode } from "./node.ts";

/** The block an upload becomes: an image, or an attachment row. */
export function $nodeForUpload(item: Uploaded): LexicalNode {
	return item.kind === "image"
		? $createImageNode(item.src, item.alt)
		: $createFileNode(item.src, item.name, item.size);
}
