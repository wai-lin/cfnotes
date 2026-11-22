import {
	DecoratorNode,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

export type SerializedDatabaseNode = Spread<{ databaseId: string }, SerializedLexicalNode>;

/** The custom element a database block draws (set by `databaseExtension`). */
let elementName = "cf-database";
export const setDatabaseElement = (name: string) => void (elementName = name);

/**
 * An inline database: a block that draws the app's database element (with
 * `data-id`) for the database it names. The element does the rest.
 */
export class DatabaseNode extends DecoratorNode<null> {
	__databaseId: string;

	static override getType(): string {
		return "database";
	}

	static override clone(node: DatabaseNode): DatabaseNode {
		return new DatabaseNode(node.__databaseId, node.__key);
	}

	static override importJSON(json: SerializedDatabaseNode): DatabaseNode {
		return $createDatabaseNode(json.databaseId).updateFromJSON(json);
	}

	constructor(databaseId: string, key?: NodeKey) {
		super(key);
		this.__databaseId = databaseId;
	}

	getDatabaseId(): string {
		return this.__databaseId;
	}

	override exportJSON(): SerializedDatabaseNode {
		return { ...super.exportJSON(), databaseId: this.__databaseId };
	}

	override createDOM(): HTMLElement {
		const block = document.createElement("div");
		block.className = "ne-database";
		block.contentEditable = "false";
		const view = document.createElement(elementName);
		view.dataset.id = this.__databaseId;
		block.append(view);
		return block;
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

export function $createDatabaseNode(databaseId: string): DatabaseNode {
	return new DatabaseNode(databaseId);
}

export function $isDatabaseNode(node: LexicalNode | null | undefined): node is DatabaseNode {
	return node instanceof DatabaseNode;
}
