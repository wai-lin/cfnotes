import { mergeRegister } from "@lexical/utils";

import type { EditorExtension } from "../../core/extension.ts";
import { $selectedBlocks } from "../../shared/blocks.ts";
import { listen, onPointerOutside } from "../../shared/dom.ts";
import {
	$anyConvertible,
	$blockKeyOf,
	$dropBlocks,
	$duplicateGroup,
	$removeGroup,
	$startSlashLineAfter,
	$topLevelKeyOf,
	$turnGroupInto,
	dropPlacement,
} from "./logic.ts";
import { createBlockHandlesStore } from "./state.ts";
import { blockAt, createBlockHandlesView, HANDLE_W } from "./view.ts";

/** How far past the editor's edges the pointer still counts as over it. */
const GUTTER = 24;

/**
 * Notion-style block handles: hovering a block shows `+` (insert below) and a
 * ⋮⋮ grip beside it. Dragging the grip moves the block (or the selected
 * blocks; past a block's side, into a new column); clicking it opens a menu
 * with Duplicate / Delete / Turn into.
 */
export function blockHandlesExtension(): EditorExtension {
	return {
		name: "block-handles",
		register({ editor, host, schema }) {
			const store = createBlockHandlesStore();
			const turnInto = schema.items.filter((item) => item.turnInto);
			const sides = schema.has("columns");

			const hide = () => {
				const { menu, dragging } = store.get();
				if (!menu && dragging.length === 0) store.set({ block: null });
			};
			const closeMenu = () => store.set({ menu: null });

			const view = createBlockHandlesView({
				host,
				blockElement: (key) => editor.getElementByKey(key),
				turnInto,
				onPlus() {
					const key = store.get().block?.key;
					if (!key) return;
					closeMenu();
					editor.update(() => $startSlashLineAfter(key));
					editor.focus();
				},
				onGripPress() {
					const key = store.get().block?.key;
					const selected = editor.read(() => $selectedBlocks().map((b) => b.getKey()));
					store.set({ group: key && selected.includes(key) ? selected : key ? [key] : [] });
				},
				onGripClick() {
					if (store.get().menu) return closeMenu();
					const { group } = store.get();
					if (group.length === 0) return;
					const convertible = editor.read(() => $anyConvertible(group, schema.convertible));
					store.set({ menu: { convertible } });
				},
				onDragStart(event) {
					const { block, group } = store.get();
					if (!block) return;
					closeMenu();
					event.dataTransfer?.setData("text/plain", "");
					if (event.dataTransfer) {
						event.dataTransfer.effectAllowed = "move";
						event.dataTransfer.setDragImage(block.element, 20, 10);
					}
					store.set({ dragging: group.length > 0 ? group : [block.key] });
				},
				onDragEnd: () => endDrag(),
				onDuplicate() {
					closeMenu();
					const { group } = store.get();
					editor.update(() => $duplicateGroup(editor, group));
					editor.focus();
				},
				onDelete() {
					closeMenu();
					const { group } = store.get();
					editor.update(() => $removeGroup(group));
					hide();
				},
				onTurnInto(index) {
					closeMenu();
					const item = turnInto[index];
					const { group } = store.get();
					if (item) editor.update(() => $turnGroupInto(editor, group, item));
					editor.focus();
				},
			});
			const offRender = store.subscribe((state, prev) => view.render(state, prev));

			const endDrag = () => {
				store.set({ dragging: [], drop: null });
				hide();
			};

			/**
			 * Hover tracking on the whole document, not just the editor: the handle sits
			 * in the margin left of the editor's box, so the pointer leaves the editor on
			 * its way to the grip. It counts as "over the editor" anywhere in that margin.
			 */
			let frame = 0;
			let last: MouseEvent | null = null;
			const track = () => {
				frame = 0;
				const event = last;
				const { dragging, menu } = store.get();
				if (!event || dragging.length > 0 || menu) return;
				// A pressed button means a drag may be starting: moving the handle now
				// would pull the grip out from under the pointer before dragstart fires.
				if (event.buttons & 1) return;
				if (view.handle.contains(event.target as Node)) return;
				const box = host.getBoundingClientRect();
				const { clientX: x, clientY: y } = event;
				const near =
					x >= box.left - HANDLE_W - GUTTER &&
					x <= box.right + GUTTER &&
					y >= box.top - 4 &&
					y <= box.bottom + 4;
				if (!near) return hide();
				// In the gaps between blocks, keep the handle where it is.
				const root = editor.getRootElement();
				const element = root ? blockAt(root, x, y) : null;
				if (!element) return;
				const key = editor.read(() => $blockKeyOf(element));
				store.set({ block: key ? { key, element } : null });
			};

			const onDragOver = (event: DragEvent) => {
				const { dragging } = store.get();
				if (dragging.length === 0) return;
				event.preventDefault();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
				const root = editor.getRootElement();
				const element = root ? blockAt(root, event.clientX, event.clientY) : null;
				if (!element) return;
				const key = editor.read(() => $topLevelKeyOf(element));
				if (!key || dragging.includes(key)) return store.set({ drop: null });
				const placement = dropPlacement(
					element.getBoundingClientRect(),
					event.clientX,
					event.clientY,
					sides,
				);
				const { drop } = store.get();
				if (drop?.key !== key || drop.before !== placement.before || drop.side !== placement.side)
					store.set({ drop: { key, ...placement } });
			};

			const onDrop = (event: DragEvent) => {
				const { dragging, drop } = store.get();
				if (dragging.length === 0) return;
				event.preventDefault();
				endDrag();
				if (drop) editor.update(() => $dropBlocks(editor, dragging, drop));
			};

			return mergeRegister(
				listen(
					document,
					"mousemove",
					(event: MouseEvent) => {
						last = event;
						frame ||= requestAnimationFrame(track);
					},
					{ passive: true },
				),
				listen(document.documentElement, "mouseleave", hide),
				() => cancelAnimationFrame(frame),
				// On the document: a drop beside a block lands in the page margin, outside the editor.
				listen(document, "dragover", onDragOver),
				listen(document, "drop", onDrop),
				onPointerOutside(() => [view.menu, view.grip], closeMenu),
				// Typing: get the chrome out of the way.
				listen(host, "keydown", () => {
					closeMenu();
					hide();
				}),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
