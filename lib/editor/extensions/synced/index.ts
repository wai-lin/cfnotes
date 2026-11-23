import { $generateJSONFromSelectedNodes } from "@lexical/clipboard";
import { $dfs, $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
	$addUpdateTag,
	$createNodeSelection,
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	$parseSerializedNode,
	type LexicalEditor,
	type SerializedLexicalNode,
} from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { listen } from "../../shared/dom.ts";
import { onLoaded, reconcile, syncedIn, type JsonNode } from "./logic.ts";
import { $createSyncedNode, $isSyncedNode, SyncedNode } from "./node.ts";
import { createSyncedBar } from "./view.ts";

export { $createSyncedNode, $isSyncedNode, SyncedNode } from "./node.ts";

/** Where synced blocks' content is kept. */
export interface SyncedStore {
	/** The latest content of these blocks; a block missing from the answer was never saved. */
	load(ids: string[]): Promise<Record<string, unknown[]> | null>;
	/** Replaces a block's content; `false` when that didn't work. */
	save(id: string, children: unknown[], keepalive?: boolean): Promise<boolean>;
}

/** Updates that bring content from elsewhere: not edits, so they aren't saved back. */
const REMOTE = "synced-remote";
/** Wait this long after the last edit before saving. */
const SAVE_DELAY = 800;

/**
 * Synced blocks (Notion's): blocks kept in one place and shown wherever a
 * copy of the block is. `/synced` makes one; copying it (or "Copy and sync")
 * and pasting into another page makes another copy. Edits save to the
 * store, every copy on the page follows, and other pages catch up when they
 * load or come back into view. "Unsync" turns a copy back into plain blocks.
 */
export function syncedExtension({ store }: { store: SyncedStore }): EditorExtension {
	return {
		name: "synced",
		nodes: [SyncedNode],
		items: [
			{
				id: "synced",
				label: "Synced block",
				hint: "Show the same blocks on several pages",
				keywords: "synced sync mirror reuse shared transclusion",
				order: 135,
				hiddenIn: ["table", "column"],
				apply: () => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;
					const block = selection.anchor.getNode().getTopLevelElement();
					if (!block) return;
					const synced = $createSyncedNode(crypto.randomUUID());
					block.replace(synced);
					synced.append(block);
					block.selectEnd();
				},
			},
		],
		register({ editor, host }) {
			/** Each block's content as last agreed with the store (a JSON string of its children). */
			const known = new Map<string, string>();
			/** Edits waiting to be saved, by block. */
			const pending = new Map<string, { json: string; timer: ReturnType<typeof setTimeout> }>();
			const loading = new Set<string>();

			const copies = () => syncedIn(editor.getEditorState().toJSON().root as unknown as JsonNode);
			/** Each block's copies on the page, in document order, by node key. */
			const copyKeys = () =>
				editor.getEditorState().read(() => {
					const keys = new Map<string, string[]>();
					for (const { node } of $dfs()) {
						if (
							!$isSyncedNode(node) ||
							$findMatchingParent(node.getParent() ?? node, $isSyncedNode)
						)
							continue;
						const list = keys.get(node.getSyncId()) ?? [];
						list.push(node.getKey());
						keys.set(node.getSyncId(), list);
					}
					return keys;
				});
			/** Copies there at the last update: any other copy was just pasted or made. */
			let seen = new Set<string>();

			/** Puts `json` into every copy of block `id` on the page that differs. */
			const show = (id: string, json: string) => {
				const children = JSON.parse(json) as SerializedLexicalNode[];
				editor.update(
					() => {
						$addUpdateTag("history-merge");
						for (const node of $dfs().map((d) => d.node)) {
							if (!$isSyncedNode(node) || node.getSyncId() !== id) continue;
							const current = JSON.stringify(node.getChildren().map((c) => c.exportJSON()));
							if (current === json) continue;
							const selection = $getSelection();
							const wasInside =
								$isRangeSelection(selection) && node.isParentOf(selection.anchor.getNode());
							node.clear();
							const nodes = children.flatMap((child) => {
								try {
									return [$parseSerializedNode(child)];
								} catch {
									return [];
								}
							});
							node.append(...(nodes.length > 0 ? nodes : [$createParagraphNode()]));
							if (wasInside) node.selectEnd();
						}
					},
					{ tag: REMOTE },
				);
			};

			const save = (id: string, json: string, keepalive = false) => {
				const job = pending.get(id);
				if (job) clearTimeout(job.timer);
				pending.delete(id);
				void store.save(id, JSON.parse(json) as unknown[], keepalive).then((ok) => {
					if (ok) known.set(id, json);
					// Failed: try again on the next edit or when the page comes back.
					else if (!pending.has(id)) known.delete(id);
				});
			};

			const later = (id: string, json: string) => {
				const job = pending.get(id);
				if (job) clearTimeout(job.timer);
				pending.set(id, { json, timer: setTimeout(() => save(id, json), SAVE_DELAY) });
			};

			/** Fetches blocks from the store and shows (or saves) what `onLoaded` says. */
			const load = async (ids: string[]) => {
				const fresh = ids.filter((id) => !loading.has(id) && !pending.has(id));
				if (fresh.length === 0) return;
				for (const id of fresh) loading.add(id);
				const before = copies();
				const blocks = await store.load(fresh).catch(() => null);
				for (const id of fresh) loading.delete(id);
				if (!blocks) return;
				const now = copies();
				for (const id of fresh) {
					const was = before.get(id)?.[0];
					const is = now.get(id)?.[0];
					if (was === undefined || is === undefined || pending.has(id)) continue;
					const server = id in blocks ? JSON.stringify(blocks[id]) : undefined;
					const next = onLoaded(server, was, is);
					if (server !== undefined) known.set(id, server);
					if (next.show !== null) show(id, next.show);
					if (next.save !== null) later(id, next.save);
				}
			};

			// Blocks seen for the first time get loaded; edits to known ones get saved.
			const onUpdate = ({ tags }: { tags: Set<string> }) => {
				const found = copies();
				const keys = copyKeys();
				const wasSeen = seen;
				seen = new Set([...keys.values()].flat());
				const unknown = [...found.keys()].filter((id) => !known.has(id));
				if (unknown.length > 0) void load(unknown);
				if (tags.has(REMOTE)) return;
				for (const [id, list] of found) {
					if (!known.has(id)) continue;
					const ids = keys.get(id) ?? [];
					const base = pending.get(id)?.json ?? known.get(id)!;
					const next = reconcile(
						list.map((json, i) => ({ json, fresh: !wasSeen.has(ids[i] ?? "") })),
						base,
					);
					// Every copy on this page follows at once.
					if (next.redraw) show(id, next.content);
					if (next.save) later(id, next.content);
				}
				bar.update();
			};

			const refresh = () => {
				if (document.visibilityState !== "visible") return;
				const ids = [...copies().keys()].filter((id) => !pending.has(id));
				for (const id of ids) known.delete(id);
				void load(ids);
			};
			const flush = () => {
				for (const [id, job] of pending) save(id, job.json, true);
			};

			const bar = createSyncedBar(host, {
				find: (target) => target.closest<HTMLElement>(".ne-synced"),
				onCopy: (element) => copySynced(editor, element),
				onUnsync: (element) => unsync(editor, element),
			});

			// A copy of a synced block can't go inside another: it's unwrapped.
			const offTransform = editor.registerNodeTransform(SyncedNode, (node) => {
				const outer = $findMatchingParent(node.getParent() ?? node, (n) => $isSyncedNode(n));
				if (outer && outer !== node) {
					for (const child of node.getChildren()) node.insertBefore(child);
					node.remove();
				}
			});

			onUpdate({ tags: new Set() });
			return mergeRegister(
				editor.registerUpdateListener(onUpdate),
				offTransform,
				listen(window, "focus", refresh),
				listen(document, "visibilitychange", () =>
					document.visibilityState === "hidden" ? flush() : refresh(),
				),
				listen(window, "pagehide", flush),
				bar.destroy,
				() => {
					flush();
					for (const job of pending.values()) clearTimeout(job.timer);
				},
			);
		},
	};
}

/**
 * Copies a synced block in the editor's clipboard format, which keeps its id,
 * so pasting it into another page makes a synced copy. (Selecting the block
 * and copying the usual way would clear the browser's selection, and the copy
 * event would never reach the editor.)
 */
function copySynced(editor: LexicalEditor, element: HTMLElement): boolean {
	const copied = editor.read(() => {
		const node = $getNearestNodeFromDOMNode(element);
		const synced = $isSyncedNode(node) ? node : node && $findMatchingParent(node, $isSyncedNode);
		if (!$isSyncedNode(synced)) return null;
		const selection = $createNodeSelection();
		selection.add(synced.getKey());
		return {
			lexical: JSON.stringify($generateJSONFromSelectedNodes(editor, selection)),
			text: synced.getTextContent(),
		};
	});
	if (!copied) return false;
	const onCopy = (event: ClipboardEvent) => {
		if (!event.clipboardData) return;
		event.preventDefault();
		event.clipboardData.setData("application/x-lexical-editor", copied.lexical);
		event.clipboardData.setData("text/plain", copied.text);
	};
	document.addEventListener("copy", onCopy, true);
	try {
		return document.execCommand("copy");
	} finally {
		document.removeEventListener("copy", onCopy, true);
	}
}

/** Turns a copy back into ordinary blocks, on this page only. */
function unsync(editor: LexicalEditor, element: HTMLElement): void {
	editor.update(() => {
		const node = $getNearestNodeFromDOMNode(element);
		if (!$isSyncedNode(node)) return;
		const children = node.getChildren();
		for (const child of children) node.insertBefore(child);
		node.remove();
		children.at(-1)?.selectEnd();
		if ($getRoot().getChildrenSize() === 0) $getRoot().append($createParagraphNode());
	});
}
