import {
	DecoratorNode,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { createFileElement } from "./view";

export type SerializedFileNode = Spread<
	{ src: string; name: string; size: number },
	SerializedLexicalNode
>;

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
		return createFileElement({ src: this.__src, name: this.__name, size: this.__size });
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
