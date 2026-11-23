import {
	$applyNodeReplacement,
	ElementNode,
	type LexicalNode,
	type NodeKey,
	type SerializedElementNode,
	type Spread,
} from "lexical";

export type SerializedSyncedNode = Spread<{ syncId: string }, SerializedElementNode>;

/**
 * A synced block: blocks whose content is kept in one place and shown in every
 * page holding a synced block with the same `syncId`. It's a little document
 * of its own (like a column), so typing stays inside it.
 */
export class SyncedNode extends ElementNode {
	__syncId: string;

	static override getType(): string {
		return "synced";
	}

	static override clone(node: SyncedNode): SyncedNode {
		return new SyncedNode(node.__syncId, node.__key);
	}

	static override importJSON(json: SerializedSyncedNode): SyncedNode {
		return $createSyncedNode(json.syncId).updateFromJSON(json);
	}

	constructor(syncId: string, key?: NodeKey) {
		super(key);
		this.__syncId = syncId;
	}

	getSyncId(): string {
		return this.getLatest().__syncId;
	}

	override exportJSON(): SerializedSyncedNode {
		return { ...super.exportJSON(), syncId: this.getSyncId() };
	}

	override createDOM(): HTMLElement {
		const dom = document.createElement("div");
		dom.className = "ne-synced";
		dom.dataset.syncId = this.__syncId;
		return dom;
	}

	override updateDOM(prev: this, dom: HTMLElement): boolean {
		if (prev.__syncId !== this.__syncId) dom.dataset.syncId = this.__syncId;
		return false;
	}

	override isShadowRoot(): boolean {
		return true;
	}

	override canBeEmpty(): boolean {
		return false;
	}
}

export function $createSyncedNode(syncId: string): SyncedNode {
	return $applyNodeReplacement(new SyncedNode(syncId));
}

export function $isSyncedNode(node: LexicalNode | null | undefined): node is SyncedNode {
	return node instanceof SyncedNode;
}
