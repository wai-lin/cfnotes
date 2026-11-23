import {
	DecoratorNode,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import type { MediaKind } from "../../shared/upload.ts";
import { createMediaElement } from "./view.ts";

export type SerializedMediaNode = Spread<
	{ media: MediaKind; src: string; name: string; size: number },
	SerializedLexicalNode
>;

const KINDS: readonly MediaKind[] = ["audio", "video", "pdf"];

/** An uploaded audio or video file with a player, or a PDF shown in the page. */
export class MediaNode extends DecoratorNode<null> {
	__media: MediaKind;
	__src: string;
	__name: string;
	__size: number;

	static override getType(): string {
		return "media";
	}

	static override clone(node: MediaNode): MediaNode {
		return new MediaNode(node.__media, node.__src, node.__name, node.__size, node.__key);
	}

	static override importJSON(json: SerializedMediaNode): MediaNode {
		const media = KINDS.includes(json.media) ? json.media : "video";
		return $createMediaNode(media, json.src, json.name, json.size).updateFromJSON(json);
	}

	constructor(media: MediaKind, src: string, name: string, size: number, key?: NodeKey) {
		super(key);
		this.__media = media;
		this.__src = src;
		this.__name = name;
		this.__size = size;
	}

	override exportJSON(): SerializedMediaNode {
		return {
			...super.exportJSON(),
			media: this.__media,
			src: this.__src,
			name: this.__name,
			size: this.__size,
		};
	}

	override createDOM(): HTMLElement {
		return createMediaElement({
			media: this.__media,
			src: this.__src,
			name: this.__name,
			size: this.__size,
		});
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

export function $createMediaNode(
	media: MediaKind,
	src: string,
	name: string,
	size: number,
): MediaNode {
	return new MediaNode(media, src, name, size);
}

export function $isMediaNode(node: LexicalNode | null | undefined): node is MediaNode {
	return node instanceof MediaNode;
}
