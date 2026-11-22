import { icon, type IconName } from "#lib/icons.ts";

/**
 * Sort and filter controls for a database table: the Filter / Sort buttons, the
 * bar of active sorts and filters under them, and their panels.
 */
import type { Column, DatabaseState } from "../columns.ts";
import { filterType, findOp, isIdle, newFilter, opsFor, type Filter, type View } from "../view.ts";
import type { Popover } from "./popover.ts";

export interface ViewContext {
	state(): DatabaseState | null;
	/** The view being shown. */
	view(): View;
	pop: Popover;
	/** Shows `view` now and saves it. `typing` waits a moment and keeps open panels as they are. */
	setView(view: View, typing?: boolean): void;
	/** Element to anchor a panel to after a redraw (e.g. the chip of a new filter). */
	find(selector: string): HTMLElement | null;
	typeIcon(column: Column): IconName;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function button(className: string, iconName: IconName | null, label: string): HTMLButtonElement {
	const el = h("button", className);
	el.type = "button";
	if (iconName) el.insertAdjacentHTML("beforeend", icon(iconName, 14));
	el.append(h("span", "", label));
	return el;
}

function select(
	label: string,
	options: { value: string; label: string; disabled?: boolean }[],
	value: string,
) {
	const el = h("select", "db-select");
	el.setAttribute("aria-label", label);
	for (const option of options) {
		const item = new Option(option.label, option.value, false, option.value === value);
		item.disabled = Boolean(option.disabled);
		el.append(item);
	}
	el.value = value;
	return el;
}

/** The Filter and Sort buttons. */
export function toolbar(ctx: ViewContext): HTMLElement {
	const bar = h("div", "db-tools");
	const filter = button(
		`db-tool db-tool-filter${ctx.view().filters.length ? " is-active" : ""}`,
		"filter",
		"Filter",
	);
	filter.addEventListener("click", () => addFilterMenu(ctx, filter));
	const sort = button(
		`db-tool db-tool-sort${ctx.view().sorts.length ? " is-active" : ""}`,
		"arrowsSort",
		"Sort",
	);
	sort.addEventListener("click", () => sortPanel(ctx, sort));
	bar.append(filter, sort);
	return bar;
}

function filterLabel(column: Column, filter: Filter): HTMLElement {
	const chip = h("span", "db-chip-text");
	chip.append(h("strong", "", column.name));
	if (isIdle(column, filter)) return chip;
	const op = findOp(column, filter.op);
	let value = "";
	if (op?.needsValue) {
		if (column.type === "select" || column.type === "multi_select") {
			value = column.options?.find((o) => o.id === filter.value)?.name ?? "";
		} else if (filterType(column) === "date" && typeof filter.value === "string") {
			const date = new Date(`${filter.value}T00:00:00`);
			value = date.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
		} else {
			value = String(filter.value);
		}
	}
	chip.append(` ${op?.label ?? ""}${value ? ` ${value}` : ""}`);
	return chip;
}

/** The bar of active sorts and filters, or `null` when there are none. */
export function viewBar(ctx: ViewContext): HTMLElement | null {
	const state = ctx.state()!;
	const { sorts, filters } = ctx.view();
	if (!sorts.length && !filters.length) return null;
	const bar = h("div", "db-viewbar");

	if (sorts.length) {
		const first = state.columns.find((c) => c.id === sorts[0]!.columnId);
		const label = sorts.length === 1 && first ? first.name : `${sorts.length} sorts`;
		const chip = button(
			"db-chip db-chip-sort",
			sorts.length === 1 && sorts[0]!.direction === "desc" ? "arrowDown" : "arrowUp",
			label,
		);
		chip.addEventListener("click", () => sortPanel(ctx, chip));
		bar.append(chip);
		if (filters.length) bar.append(h("span", "db-viewbar-sep"));
	}

	for (const filter of filters) {
		const column = state.columns.find((c) => c.id === filter.columnId);
		if (!column) continue;
		const chip = h("button", `db-chip db-chip-filter${isIdle(column, filter) ? " is-idle" : ""}`);
		chip.type = "button";
		chip.dataset.filter = filter.id;
		chip.append(filterLabel(column, filter));
		chip.insertAdjacentHTML("beforeend", icon("chevronDown", 12));
		chip.addEventListener("click", () => filterPanel(ctx, chip, filter.id));
		bar.append(chip);
	}
	const add = button("db-chip db-chip-add", "plus", "Filter");
	add.addEventListener("click", () => addFilterMenu(ctx, add));
	bar.append(add);
	return bar;
}

/** Pick a property to filter by; the new filter's panel opens next. */
function addFilterMenu(ctx: ViewContext, anchor: HTMLElement) {
	ctx.pop.open(anchor, (panel) => {
		const state = ctx.state();
		if (!state) return;
		panel.append(
			ctx.pop.menu([
				{ heading: "Filter by" },
				...state.columns.map((column) => ({
					label: column.name,
					icon: ctx.typeIcon(column),
					run: () => {
						const filter = newFilter(column);
						const now = ctx.state();
						if (!now) return;
						ctx.setView({ ...ctx.view(), filters: [...ctx.view().filters, filter] });
						const chip = ctx.find(`.db-chip-filter[data-filter="${filter.id}"]`);
						if (chip) filterPanel(ctx, chip, filter.id);
					},
				})),
			]),
		);
	});
}

function filterPanel(ctx: ViewContext, anchor: HTMLElement, filterId: string) {
	ctx.pop.open(anchor, (panel, refocus) => {
		const state = ctx.state();
		const filter = ctx.view().filters.find((f) => f.id === filterId);
		const column = state?.columns.find((c) => c.id === filter?.columnId);
		if (!state || !filter || !column) return ctx.pop.close();

		const update = (change: Partial<Filter> | null, typing = false) => {
			const now = ctx.state();
			if (!now) return;
			const filters = ctx.view().filters.flatMap((f) => {
				if (f.id !== filterId) return [f];
				if (!change) return [];
				const next = { ...f, ...change };
				if (next.value === undefined || next.value === "") delete next.value;
				return [next];
			});
			ctx.setView({ ...ctx.view(), filters }, typing);
		};

		const row = h("div", "db-filter-row");
		const columnSelect = select(
			"Property",
			state.columns.map((c) => ({ value: c.id, label: c.name })),
			column.id,
		);
		columnSelect.addEventListener("change", () => {
			const next = state.columns.find((c) => c.id === columnSelect.value);
			if (next) update({ columnId: next.id, op: opsFor(next)[0]!.op, value: undefined });
		});
		const opSelect = select(
			"Condition",
			opsFor(column).map((o) => ({ value: o.op, label: o.label })),
			filter.op,
		);
		opSelect.addEventListener("change", () => update({ op: opSelect.value }));
		row.append(columnSelect, opSelect);
		panel.append(row);

		if (findOp(column, filter.op)?.needsValue) {
			let input: HTMLInputElement | HTMLSelectElement;
			if (column.type === "select" || column.type === "multi_select") {
				input = select(
					"Value",
					[
						{ value: "", label: "Choose an option…" },
						...(column.options ?? []).map((o) => ({ value: o.id, label: o.name })),
					],
					typeof filter.value === "string" ? filter.value : "",
				);
				input.addEventListener("change", () => update({ value: input.value || undefined }));
			} else {
				const field = h("input", "db-pop-input db-filter-value");
				field.placeholder = "Type a value…";
				field.setAttribute("aria-label", "Value");
				if (filterType(column) === "number") field.type = "number";
				if (filterType(column) === "date") field.type = "date";
				field.value = filter.value === undefined ? "" : String(filter.value);
				if (filterType(column) === "date") {
					field.addEventListener("change", () => update({ value: field.value || undefined }));
				} else {
					field.addEventListener("input", () => {
						const raw = field.value;
						const value =
							filterType(column) === "number" ? (raw === "" ? undefined : Number(raw)) : raw;
						update({ value: Number.isNaN(value) ? undefined : value }, true);
					});
				}
				field.addEventListener("keydown", (e) => {
					if (e.key === "Enter") ctx.pop.close();
				});
				input = field;
				if (column.type !== "date") refocus(field);
			}
			panel.append(input);
		}

		panel.append(
			ctx.pop.menu([
				{ separator: true },
				{ label: "Delete filter", icon: "trash", danger: true, run: () => update(null) },
			]),
		);
	});
}

function sortPanel(ctx: ViewContext, anchor: HTMLElement) {
	ctx.pop.open(anchor, (panel) => {
		const state = ctx.state();
		if (!state) return;
		const { sorts } = ctx.view();
		const save = (next: View["sorts"]) => ctx.setView({ ...ctx.view(), sorts: next });

		// No sorts yet: pick the property to sort by.
		if (!sorts.length) {
			panel.append(
				ctx.pop.menu([
					{ heading: "Sort by" },
					...state.columns.map((column) => ({
						label: column.name,
						icon: ctx.typeIcon(column),
						run: () => {
							save([{ columnId: column.id, direction: "asc" }]);
							sortPanel(ctx, ctx.find(".db-chip-sort") ?? anchor);
						},
					})),
				]),
			);
			return;
		}

		const list = h("div", "db-sort-list");
		sorts.forEach((sort, index) => {
			const row = h("div", "db-sort-row");
			const used = new Set(sorts.filter((_, i) => i !== index).map((s) => s.columnId));
			const columnSelect = select(
				"Sort property",
				state.columns.map((c) => ({ value: c.id, label: c.name, disabled: used.has(c.id) })),
				sort.columnId,
			);
			columnSelect.addEventListener("change", () =>
				save(sorts.with(index, { ...sort, columnId: columnSelect.value })),
			);
			const direction = select(
				"Direction",
				[
					{ value: "asc", label: "Ascending" },
					{ value: "desc", label: "Descending" },
				],
				sort.direction,
			);
			direction.addEventListener("change", () =>
				save(
					sorts.with(index, { ...sort, direction: direction.value === "desc" ? "desc" : "asc" }),
				),
			);
			const remove = h("button", "db-icon-btn db-sort-remove");
			remove.type = "button";
			remove.title = "Remove sort";
			remove.setAttribute("aria-label", "Remove sort");
			remove.innerHTML = icon("x", 14);
			remove.addEventListener("click", () => save(sorts.toSpliced(index, 1)));
			row.append(columnSelect, direction, remove);
			list.append(row);
		});
		panel.append(list);

		const unused = state.columns.find((c) => !sorts.some((s) => s.columnId === c.id));
		const entries = [];
		if (unused) {
			entries.push({
				label: "Add sort",
				icon: "plus" as const,
				run: () => {
					save([...sorts, { columnId: unused.id, direction: "asc" }]);
					sortPanel(ctx, ctx.find(".db-chip-sort") ?? anchor);
				},
			});
		}
		entries.push({
			label: "Delete sort",
			icon: "trash" as const,
			danger: true,
			run: () => save([]),
		});
		panel.append(ctx.pop.menu(entries));
	});
}
