import { $dfs, mergeRegister } from "@lexical/utils";
import type { DatabaseState } from "@modules/database/columns";
import {
	$createParagraphNode,
	$getNodeByKey,
	$getRoot,
	$getSelection,
	$isNodeSelection,
	$isElementNode,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	DecoratorNode,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { alertDialog } from "../_dialog";
import { archivedToast } from "../_undo";
import { primeState } from "../database/database-view";

export type SerializedDatabaseNode = Spread<{ databaseId: string }, SerializedLexicalNode>;

/** An inline database: a block that draws `<cf-database>` for the database it names. */
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
		const view = document.createElement("cf-database");
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

/** Creates an inline database on the server and puts it at the cursor. */
export const INSERT_DATABASE_COMMAND = createCommand<void>("INSERT_DATABASE_COMMAND");

export function registerDatabases(editor: LexicalEditor, host: HTMLElement): () => void {
	const path = () => host.closest<HTMLElement>("[data-db-path]")?.dataset.dbPath;

	let creating = false;
	const insert = async (blockKey: NodeKey | null) => {
		const action = path();
		if (!action || creating) return;
		creating = true;
		try {
			const res = await fetch(location.pathname + action, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ op: "create" }),
			});
			if (!res.ok) throw new Error(`create database failed: ${res.status}`);
			const { state } = (await res.json()) as { state: DatabaseState };
			primeState(state);
			editor.update(() => {
				const node = $createDatabaseNode(state.id);
				const block = blockKey ? $getNodeByKey(blockKey) : null;
				if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.replace(node);
				else if (block) block.insertAfter(node);
				else $getRoot().append(node);
				// Leave somewhere to keep writing below.
				const next = node.getNextSibling() ?? node.insertAfter($createParagraphNode());
				next.selectStart();
			});
		} catch (error) {
			console.warn(error);
			void alertDialog("Couldn't create the database", "Check your connection and try again.");
		} finally {
			creating = false;
		}
	};

	// "Delete database" in its ⋯ menu: it went to Trash, so drop the block
	// too, and offer Undo, which restores it and puts the block back where it was.
	const onDeleted = (event: Event) => {
		const { id, title } = (event as CustomEvent<{ id: string; title: string }>).detail;
		let spot: { parent: NodeKey; index: number } | null = null;
		editor.update(() => {
			for (const { node } of $dfs()) {
				if (!$isDatabaseNode(node) || node.getDatabaseId() !== id) continue;
				const parent = node.getParent();
				if (parent && !spot) spot = { parent: parent.getKey(), index: node.getIndexWithinParent() };
				node.remove();
			}
			if ($getRoot().isEmpty()) $getRoot().append($createParagraphNode());
		});
		archivedToast({
			id,
			title,
			keepHost: true,
			onUndone: () =>
				editor.update(() => {
					const node = $createDatabaseNode(id);
					const parent = spot ? $getNodeByKey(spot.parent) : null;
					if ($isElementNode(parent) && parent.isAttached() && spot) {
						const before = parent.getChildAtIndex(spot.index);
						if (before) before.insertBefore(node);
						else parent.append(node);
					} else $getRoot().append(node);
					if (!node.getNextSibling()) node.insertAfter($createParagraphNode());
				}),
		});
	};
	host.addEventListener("cf-database-deleted", onDeleted);

	// Show when the block itself is selected (Backspace next to it selects it first).
	let marked: HTMLElement[] = [];
	const markSelected = () => {
		const keys = editor.getEditorState().read(() => {
			const selection = $getSelection();
			return $isNodeSelection(selection)
				? selection
						.getNodes()
						.filter($isDatabaseNode)
						.map((node) => node.getKey())
				: [];
		});
		for (const el of marked) el.classList.remove("is-selected");
		marked = keys.flatMap((key) => editor.getElementByKey(key) ?? []);
		for (const el of marked) el.classList.add("is-selected");
	};

	return mergeRegister(
		editor.registerCommand(
			INSERT_DATABASE_COMMAND,
			() => {
				const selection = $getSelection();
				const block = $isRangeSelection(selection)
					? selection.anchor.getNode().getTopLevelElement()
					: null;
				void insert(block?.getKey() ?? null);
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		),
		editor.registerUpdateListener(markSelected),
		() => host.removeEventListener("cf-database-deleted", onDeleted),
	);
}
