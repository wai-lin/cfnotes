import { el, iconButton, keepFocus } from "../../shared/dom";
import { icon } from "../../shared/icons";
import type { TableControlsState } from "./state";

export interface TableControlsView {
	addRow: HTMLButtonElement;
	addCol: HTMLButtonElement;
	cellButton: HTMLButtonElement;
	menu: HTMLElement;
	render(state: TableControlsState, prev?: TableControlsState): void;
	destroy(): void;
}

/**
 * "+" bars under and beside the hovered table, a menu button in the cell
 * holding the caret, and the cell menu. Lays itself out from the state;
 * `tableElement` and `cellElement` find the DOM of the nodes it names.
 */
export function createTableControlsView(options: {
	host: HTMLElement;
	tableElement: (key: string) => HTMLTableElement | null;
	cellElement: (key: string) => HTMLElement | null;
	onAdd: (line: "row" | "column") => void;
	onCellButton: () => void;
	onChoose: (index: number) => void;
	onHover: (index: number) => void;
}): TableControlsView {
	const { host } = options;
	const addRow = iconButton("table-add table-add-row", "Add a row", "plus");
	const addCol = iconButton("table-add table-add-col", "Add a column", "plus");
	const cellButton = iconButton("table-cell-btn", "Table options", "dots");
	cellButton.setAttribute("aria-haspopup", "menu");
	addRow.hidden = addCol.hidden = cellButton.hidden = true;
	for (const control of [addRow, addCol, cellButton]) keepFocus(control); // keep the caret
	host.append(addRow, addCol, cellButton);
	addRow.addEventListener("click", () => options.onAdd("row"));
	addCol.addEventListener("click", () => options.onAdd("column"));
	cellButton.addEventListener("click", options.onCellButton);

	const menu = el("div", "table-menu");
	menu.setAttribute("role", "menu");
	menu.hidden = true;
	keepFocus(menu);
	menu.addEventListener("pointermove", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".table-menu-item");
		const index = Number(item?.dataset.index ?? -1);
		if (index >= 0) options.onHover(index);
	});
	menu.addEventListener("click", (event) => {
		const item = (event.target as Element).closest<HTMLElement>(".table-menu-item");
		if (item) options.onChoose(Number(item.dataset.index));
	});
	document.body.append(menu);

	const fillMenu = (entries: NonNullable<TableControlsState["menu"]>["entries"]) => {
		menu.replaceChildren(
			...entries.map((entry, index) => {
				if (!entry.run) return el("div", "table-menu-sep");
				const item = iconButton(`table-menu-item${entry.danger ? " is-danger" : ""}`, entry.label);
				item.setAttribute("role", entry.checked === undefined ? "menuitem" : "menuitemcheckbox");
				if (entry.checked !== undefined) item.setAttribute("aria-checked", String(entry.checked));
				item.dataset.index = String(index);
				item.append(el("span", "", entry.label));
				if (entry.checked) {
					const check = el("span", "table-menu-check");
					check.innerHTML = icon("check", 14);
					item.append(check);
				}
				return item;
			}),
		);
	};

	const placeMenu = (x: number, y: number) => {
		const fitsBelow = y + menu.offsetHeight < innerHeight - 8;
		menu.style.top = `${fitsBelow ? y : Math.max(8, y - menu.offsetHeight)}px`;
		menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
	};

	const layout = (state: TableControlsState) => {
		const outer = host.getBoundingClientRect();
		const table = state.hoverKey ? options.tableElement(state.hoverKey) : null;
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

		const cell =
			(state.focused || state.menu) && state.caretKey ? options.cellElement(state.caretKey) : null;
		cellButton.hidden = !cell;
		if (cell) {
			const rect = cell.getBoundingClientRect();
			const wrap = cell.closest(".ne-table-wrap")?.getBoundingClientRect() ?? rect;
			cellButton.style.top = `${rect.top - outer.top + 5}px`;
			cellButton.style.left = `${Math.min(rect.right, wrap.right) - outer.left - 24}px`;
		}
	};

	return {
		addRow,
		addCol,
		cellButton,
		menu,
		render(state, prev) {
			if (state.menu !== prev?.menu) {
				menu.hidden = !state.menu;
				if (state.menu && state.menu.entries !== prev?.menu?.entries) {
					fillMenu(state.menu.entries);
					placeMenu(state.menu.x, state.menu.y);
				}
				for (const item of menu.querySelectorAll<HTMLElement>(".table-menu-item"))
					item.classList.toggle("is-active", Number(item.dataset.index) === state.menu?.active);
			}
			layout(state);
		},
		destroy() {
			addRow.remove();
			addCol.remove();
			cellButton.remove();
			menu.remove();
		},
	};
}
