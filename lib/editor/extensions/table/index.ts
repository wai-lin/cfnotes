import {
	$isTableCellNode,
	registerTablePlugin,
	registerTableSelectionObserver,
	setScrollableTablesActive,
	TableCellNode,
	TableNode,
	TableRowNode,
} from "@lexical/table";
import { mergeRegister } from "@lexical/utils";
import { BLUR_COMMAND, COMMAND_PRIORITY_LOW, FOCUS_COMMAND, type LexicalEditor } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { listen, onPointerOutside } from "../../shared/dom.ts";
import {
	$appendLine,
	$caretCellKey,
	$insertTable,
	$table,
	$tableKeyAt,
	$tableMenu,
	nextEntry,
} from "./logic.ts";
import { createTableControlsStore } from "./state.ts";
import { createTableControlsView } from "./view.ts";

export { $insertTable } from "./logic.ts";

/**
 * Simple tables with a header row: Tab moves between cells, wide tables
 * scroll sideways, and Notion-style controls add rows and columns or open a
 * cell menu (insert/delete rows and columns, headers, delete the table).
 */
export function tableExtension(): EditorExtension {
	return {
		name: "table",
		nodes: [TableNode, TableRowNode, TableCellNode],
		containers: [{ name: "table", test: $isTableCellNode }],
		items: [
			{
				id: "table",
				label: "Table",
				hint: "Simple table with a header row",
				keywords: "table grid rows columns",
				order: 240,
				hiddenIn: ["table"],
				apply: $insertTable,
			},
		],
		register({ editor, host }) {
			// Wide tables scroll sideways inside their own wrapper instead of the page.
			setScrollableTablesActive(editor, true);
			return mergeRegister(
				registerTablePlugin(editor),
				registerTableSelectionObserver(editor, true), // Tab moves between cells
				registerTableControls(editor, host),
			);
		},
	};
}

function registerTableControls(editor: LexicalEditor, host: HTMLElement): () => void {
	const store = createTableControlsStore();

	const tableElement = (key: string) => {
		const dom = editor.getElementByKey(key);
		if (!dom) return null;
		return dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
	};

	const closeMenu = () => store.set({ menu: null });
	const openMenu = (x: number, y: number) => {
		const entries = editor.read(() => $tableMenu(store.get().caretKey));
		if (entries.length > 0) store.set({ menu: { entries, active: -1, x, y } });
	};
	const run = (index: number) => {
		const entry = store.get().menu?.entries[index];
		closeMenu();
		const action = entry?.run;
		if (action) editor.update(action);
		editor.focus();
	};
	const highlight = (index: number) => {
		const { menu } = store.get();
		if (menu && menu.active !== index) store.set({ menu: { ...menu, active: index } });
	};

	const view = createTableControlsView({
		host,
		tableElement,
		cellElement: (key) => editor.getElementByKey(key),
		onAdd: (line) => {
			const key = store.get().hoverKey;
			editor.update(() => $appendLine(key, line));
		},
		onCellButton: () => {
			if (store.get().menu) return closeMenu();
			const rect = view.cellButton.getBoundingClientRect();
			openMenu(rect.left, rect.bottom + 4);
		},
		onChoose: run,
		onHover: highlight,
	});
	const layout = () => view.render(store.get(), store.get());
	const offRender = store.subscribe((state, prev) => view.render(state, prev));

	// ---- hover: which table the "+" bars belong to ----
	const onPointerMove = (event: PointerEvent) => {
		const target = event.target as Element;
		if (target === view.addRow || target === view.addCol) return;
		const table = target.closest(".ne-table");
		let key = table && host.contains(table) ? editor.read(() => $tableKeyAt(table)) : null;
		// Keep the controls while crossing the gap between the table and its "+" bars.
		const { hoverKey } = store.get();
		if (!key && hoverKey) {
			const rect = tableElement(hoverKey)?.getBoundingClientRect();
			const near =
				rect &&
				event.clientX >= rect.left &&
				event.clientX <= rect.right + 28 &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom + 28;
			if (near) key = hoverKey;
		}
		store.set({ hoverKey: key });
	};

	const onContextMenu = (event: MouseEvent) => {
		const target = event.target as Element;
		if (!target.closest(".ne-td, .ne-th") || !host.contains(target)) return;
		event.preventDefault();
		// The browser has already moved the caret into the clicked cell.
		requestAnimationFrame(() => openMenu(event.clientX, event.clientY));
	};

	// While the menu is open, the keyboard drives it rather than the editor.
	const onKeyDown = (event: KeyboardEvent) => {
		const { menu } = store.get();
		if (!menu) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			highlight(nextEntry(menu.entries, menu.active, event.key === "ArrowDown" ? 1 : -1));
		} else if (event.key === "Enter" && menu.active >= 0) {
			run(menu.active);
		} else if (event.key === "Escape") {
			closeMenu();
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
	};

	const resizes = new ResizeObserver(layout);
	resizes.observe(host);

	const focus = (focused: boolean) => () => {
		store.set({ focused });
		return false;
	};

	return mergeRegister(
		editor.registerUpdateListener(({ editorState }) => {
			const caretKey = editorState.read($caretCellKey);
			const { hoverKey } = store.get();
			store.set({
				caretKey,
				hoverKey: hoverKey && editorState.read(() => $table(hoverKey)) ? hoverKey : null,
			});
			if (!caretKey) closeMenu();
			layout();
		}),
		editor.registerCommand(FOCUS_COMMAND, focus(true), COMMAND_PRIORITY_LOW),
		editor.registerCommand(BLUR_COMMAND, focus(false), COMMAND_PRIORITY_LOW),
		listen(host, "pointermove", onPointerMove),
		listen(host, "pointerleave", () => store.set({ hoverKey: null })),
		listen(host, "contextmenu", onContextMenu),
		listen(document, "keydown", onKeyDown, true),
		onPointerOutside(() => [view.menu, view.cellButton], closeMenu),
		listen(window, "resize", layout),
		listen(window, "scroll", layout, true),
		() => resizes.disconnect(),
		offRender,
		() => view.destroy(),
	);
}
