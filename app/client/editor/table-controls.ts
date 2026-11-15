import {
	$deleteTableColumnAtSelection,
	$deleteTableRowAtSelection,
	$insertTableColumnAtNode,
	$insertTableColumnAtSelection,
	$insertTableRowAtNode,
	$insertTableRowAtSelection,
	$isTableCellNode,
	$isTableNode,
	$isTableRowNode,
	$isTableSelection,
	$setTableColumnIsHeader,
	$setTableRowIsHeader,
	TableCellHeaderStates,
	type TableCellNode,
	type TableNode,
} from "@lexical/table";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { icon, type IconName } from "@modules/icons";
import {
	$createParagraphNode,
	$getNearestNodeFromDOMNode,
	$getNodeByKey,
	$getSelection,
	$isRangeSelection,
	BLUR_COMMAND,
	COMMAND_PRIORITY_LOW,
	FOCUS_COMMAND,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

function button(className: string, label: string, glyph?: IconName) {
	const node = document.createElement("button");
	node.type = "button";
	node.className = className;
	node.setAttribute("aria-label", label);
	if (glyph) node.innerHTML = icon(glyph, 14);
	return node;
}

/** The `<table>` element of a table node (its DOM may be a scroll wrapper). */
function tableElement(editor: LexicalEditor, key: NodeKey): HTMLTableElement | null {
	const dom = editor.getElementByKey(key);
	if (!dom) return null;
	return dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
}

function $table(key: NodeKey | null): TableNode | null {
	const node = key ? $getNodeByKey(key) : null;
	return $isTableNode(node) ? node : null;
}

function $lastCell(table: TableNode, row: "first" | "last"): TableCellNode | null {
	const tr = row === "first" ? table.getFirstChild() : table.getLastChild();
	const cell = $isTableRowNode(tr) ? tr.getLastChild() : null;
	return $isTableCellNode(cell) ? cell : null;
}

interface MenuItem {
	label: string;
	run?: () => void;
	checked?: boolean;
	danger?: boolean;
}

/**
 * Notion-style table controls:
 * - "+" bars under and beside the hovered table add a row or a column;
 * - a button in the cell holding the caret (or right-clicking a cell) opens a
 *   menu to insert/delete rows and columns, toggle headers, or delete the table.
 */
export function registerTableControls(editor: LexicalEditor, host: HTMLElement): () => void {
	const addRow = button("table-add table-add-row", "Add a row", "plus");
	const addCol = button("table-add table-add-col", "Add a column", "plus");
	const cellButton = button("table-cell-btn", "Table options", "dots");
	cellButton.setAttribute("aria-haspopup", "menu");
	addRow.hidden = addCol.hidden = cellButton.hidden = true;
	host.append(addRow, addCol, cellButton);

	const menu = document.createElement("div");
	menu.className = "table-menu";
	menu.setAttribute("role", "menu");
	menu.hidden = true;
	document.body.append(menu);

	let hoverKey: NodeKey | null = null; // table under the pointer
	let caretKey: NodeKey | null = null; // cell holding the caret
	let focused = false;

	// ---- layout ----
	const layout = () => {
		const outer = host.getBoundingClientRect();
		const table = hoverKey ? tableElement(editor, hoverKey) : null;
		addRow.hidden = addCol.hidden = !table;
		if (table) {
			const rect = table.getBoundingClientRect();
			const wrap = table.parentElement?.getBoundingClientRect() ?? rect;
			const right = Math.min(rect.right, wrap.right); // wide tables scroll inside the wrapper
			Object.assign(addRow.style, {
				top: `${rect.bottom - outer.top + 4}px`,
				left: `${rect.left - outer.left}px`,
				width: `${right - rect.left}px`,
			});
			Object.assign(addCol.style, {
				top: `${rect.top - outer.top}px`,
				left: `${Math.min(right + 4, outer.right - 18) - outer.left}px`,
				height: `${rect.height}px`,
			});
		}

		const cell = focused || !menu.hidden ? caretKey && editor.getElementByKey(caretKey) : null;
		cellButton.hidden = !cell;
		if (cell) {
			const rect = cell.getBoundingClientRect();
			const wrap = cell.closest(".ne-table-wrap")?.getBoundingClientRect() ?? rect;
			cellButton.style.top = `${rect.top - outer.top + 5}px`;
			cellButton.style.left = `${Math.min(rect.right, wrap.right) - outer.left - 24}px`;
		}
	};

	// ---- hover ----
	const tableKeyAt = (target: Element): NodeKey | null => {
		const table = target.closest(".ne-table");
		if (!table || !host.contains(table)) return null;
		return editor.read(() => {
			const node = $getNearestNodeFromDOMNode(table);
			return node ? ($findMatchingParent(node, $isTableNode)?.getKey() ?? null) : null;
		});
	};

	const onPointerMove = (event: PointerEvent) => {
		const target = event.target as Element;
		if (target === addRow || target === addCol) return;
		let key = tableKeyAt(target);
		// Keep the controls while crossing the gap between the table and its "+" bars.
		if (!key && hoverKey) {
			const rect = tableElement(editor, hoverKey)?.getBoundingClientRect();
			const near =
				rect &&
				event.clientX >= rect.left &&
				event.clientX <= rect.right + 28 &&
				event.clientY >= rect.top &&
				event.clientY <= rect.bottom + 28;
			if (near) key = hoverKey;
		}
		if (key !== hoverKey) {
			hoverKey = key;
			layout();
		}
	};
	const onPointerLeave = () => {
		hoverKey = null;
		layout();
	};

	const onAdd = (event: MouseEvent) => {
		const key = hoverKey;
		const isRow = event.currentTarget === addRow;
		editor.update(() => {
			const table = $table(key);
			const cell = table && $lastCell(table, isRow ? "last" : "first");
			if (!cell) return;
			if (isRow) $insertTableRowAtNode(cell, true);
			else $insertTableColumnAtNode(cell, true, false);
		});
	};

	// ---- cell menu ----
	let items: MenuItem[] = [];
	let active = -1;

	const highlight = () => {
		for (const item of menu.querySelectorAll<HTMLElement>(".table-menu-item")) {
			item.classList.toggle("is-active", Number(item.dataset.index) === active);
		}
	};

	const runnable = () => items.flatMap((item, i) => (item.run ? [i] : []));

	const buildItems = (): MenuItem[] =>
		editor.read(() => {
			const cell = caretKey ? $getNodeByKey(caretKey) : null;
			const table = $isTableCellNode(cell) ? $findMatchingParent(cell, $isTableNode) : null;
			if (!table) return [];
			const first = $lastCell(table, "first")?.getParent()?.getFirstChild();
			const headerRow = $isTableCellNode(first) && first.hasHeaderState(TableCellHeaderStates.ROW);
			const headerCol =
				$isTableCellNode(first) && first.hasHeaderState(TableCellHeaderStates.COLUMN);
			const tableKey = table.getKey();
			const edit = (fn: () => void) => () => editor.update(fn);
			return [
				{ label: "Insert row above", run: edit(() => $insertTableRowAtSelection(false)) },
				{ label: "Insert row below", run: edit(() => $insertTableRowAtSelection(true)) },
				{ label: "Insert column left", run: edit(() => $insertTableColumnAtSelection(false)) },
				{ label: "Insert column right", run: edit(() => $insertTableColumnAtSelection(true)) },
				{ label: "" },
				{
					label: "Header row",
					checked: headerRow,
					run: edit(() => {
						const t = $table(tableKey);
						if (t) $setTableRowIsHeader(t, 0, !headerRow);
					}),
				},
				{
					label: "Header column",
					checked: headerCol,
					run: edit(() => {
						const t = $table(tableKey);
						if (t) $setTableColumnIsHeader(t, 0, !headerCol);
					}),
				},
				{ label: "" },
				{ label: "Delete row", danger: true, run: edit($deleteTableRowAtSelection) },
				{ label: "Delete column", danger: true, run: edit($deleteTableColumnAtSelection) },
				{
					label: "Delete table",
					danger: true,
					run: edit(() => {
						const t = $table(tableKey);
						if (!t) return;
						const paragraph = $createParagraphNode();
						t.replace(paragraph);
						paragraph.select();
					}),
				},
			];
		});

	const openMenu = (x: number, y: number) => {
		items = buildItems();
		if (items.length === 0) return;
		active = -1;
		menu.replaceChildren(
			...items.map((item, index) => {
				if (!item.run) {
					const line = document.createElement("div");
					line.className = "table-menu-sep";
					return line;
				}
				const entry = button(`table-menu-item${item.danger ? " is-danger" : ""}`, item.label);
				entry.setAttribute("role", item.checked === undefined ? "menuitem" : "menuitemcheckbox");
				if (item.checked !== undefined) entry.setAttribute("aria-checked", String(item.checked));
				entry.dataset.index = String(index);
				const label = document.createElement("span");
				label.textContent = item.label;
				entry.append(label);
				if (item.checked) {
					const check = document.createElement("span");
					check.className = "table-menu-check";
					check.innerHTML = icon("check", 14);
					entry.append(check);
				}
				return entry;
			}),
		);
		menu.hidden = false;
		const fitsBelow = y + menu.offsetHeight < window.innerHeight - 8;
		menu.style.top = `${fitsBelow ? y : Math.max(8, y - menu.offsetHeight)}px`;
		menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
		layout();
	};

	const closeMenu = () => {
		if (menu.hidden) return;
		menu.hidden = true;
		layout();
	};

	const runItem = (index: number) => {
		const item = items[index];
		closeMenu();
		item?.run?.();
		editor.focus();
	};

	const onCellButton = () => {
		if (!menu.hidden) return closeMenu();
		const rect = cellButton.getBoundingClientRect();
		openMenu(rect.left, rect.bottom + 4);
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
		if (menu.hidden) return;
		const order = runnable();
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			const at = order.indexOf(active);
			const step = event.key === "ArrowDown" ? 1 : -1;
			const next =
				at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length;
			active = order[next] ?? -1;
			highlight();
		} else if (event.key === "Enter" && active >= 0) {
			runItem(active);
		} else if (event.key === "Escape") {
			closeMenu();
		} else {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
	};

	const onOutside = (event: PointerEvent) => {
		const target = event.target as Node;
		if (!menu.hidden && !menu.contains(target) && !cellButton.contains(target)) closeMenu();
	};

	menu.addEventListener("mousedown", (event) => event.preventDefault());
	menu.addEventListener("pointermove", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".table-menu-item");
		const index = Number(item?.dataset.index ?? -1);
		if (index >= 0 && index !== active) {
			active = index;
			highlight();
		}
	});
	menu.addEventListener("click", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".table-menu-item");
		if (item) runItem(Number(item.dataset.index));
	});

	for (const control of [addRow, addCol, cellButton]) {
		control.addEventListener("mousedown", (event) => event.preventDefault()); // keep the caret
	}
	addRow.addEventListener("click", onAdd);
	addCol.addEventListener("click", onAdd);
	cellButton.addEventListener("click", onCellButton);
	host.addEventListener("pointermove", onPointerMove);
	host.addEventListener("pointerleave", onPointerLeave);
	host.addEventListener("contextmenu", onContextMenu);
	document.addEventListener("keydown", onKeyDown, true);
	document.addEventListener("pointerdown", onOutside, true);
	window.addEventListener("resize", layout);
	window.addEventListener("scroll", layout, true);
	const resizes = new ResizeObserver(layout);
	resizes.observe(host);

	return mergeRegister(
		editor.registerUpdateListener(({ editorState }) => {
			caretKey = editorState.read(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return null;
				const node = selection.anchor.getNode();
				const cell = $isTableCellNode(node) ? node : $findMatchingParent(node, $isTableCellNode);
				return cell?.getKey() ?? null;
			});
			if (!caretKey) closeMenu();
			if (hoverKey && !editorState.read(() => $table(hoverKey))) hoverKey = null;
			layout();
		}),
		editor.registerCommand(
			FOCUS_COMMAND,
			() => {
				focused = true;
				layout();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
		editor.registerCommand(
			BLUR_COMMAND,
			() => {
				focused = false;
				layout();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
		() => {
			host.removeEventListener("pointermove", onPointerMove);
			host.removeEventListener("pointerleave", onPointerLeave);
			host.removeEventListener("contextmenu", onContextMenu);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("pointerdown", onOutside, true);
			window.removeEventListener("resize", layout);
			window.removeEventListener("scroll", layout, true);
			resizes.disconnect();
			addRow.remove();
			addCol.remove();
			cellButton.remove();
			menu.remove();
		},
	);
}
