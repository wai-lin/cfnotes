import { icon, type IconName } from "#lib/icons.ts";
/**
 * `<cf-database data-id="…">` — a database drawn as a table, Notion style.
 *
 * - `data-full`: a full-page database (the page title is the database title).
 * - `data-row="<row id>"`: the property list shown on a row's own page.
 * - `data-state`: the initial state as JSON, to skip the first request.
 *
 * Every change is one POST (`{op, databaseId, …}`) to the page action named by
 * the nearest `[data-db-path]`; the answer is the whole database, which we draw again.
 * Inside the editor it keeps its events to itself so Lexical doesn't act on them.
 */
import { alertDialog, confirmDialog } from "#lib/ui/dialog.ts";
import { archivedToast } from "#modules/trash/client/undo.ts";
import { setIndexTitle } from "#modules/workspace/client/page-directory.ts";

import {
	columnWidth,
	COLUMN_TYPES,
	MAX_WIDTH,
	MIN_WIDTH,
	readCell,
	TITLE_COLUMN,
	TYPE_LABELS,
	type Column,
	type ColumnType,
	type DatabaseState,
	type FileRef,
	type Row,
	type SelectOption,
	STATUS_GROUPS,
} from "../columns.ts";
import { fnsFor, ROLLUP_FNS, rollupKind } from "../rollup.ts";
import { canHoldFormula, isScriptError, scriptText } from "../script/script.ts";
import {
	applyView,
	canGroup,
	emptyView,
	LAYOUT_NAMES,
	LAYOUTS,
	prefill,
	type Layout,
	type View,
} from "../view.ts";
import { Popover, type MenuEntry } from "./popover.ts";
import { toolbar, viewBar, type ViewContext } from "./view-controls.ts";

const TYPE_ICONS: Record<ColumnType, IconName> = {
	title: "letterCase",
	text: "alignLeft",
	number: "hash",
	select: "circleChevronDown",
	multi_select: "list",
	date: "calendar",
	checkbox: "squareCheck",
	url: "link",
	relation: "arrowUpRight",
	rollup: "mathFunction",
	script: "code",
	status: "progress",
	person: "user",
	files: "paperclip",
	email: "mail",
	phone: "phone",
	created_time: "clock",
	created_by: "user",
	last_edited_time: "clockEdit",
	last_edited_by: "userEdit",
};

/** Width of the last column (the "+" header and the rows' ⋯ buttons). */
const LAYOUT_ICONS: Record<Layout, IconName> = {
	table: "table",
	board: "layoutKanban",
	list: "list",
	gallery: "layoutGrid",
	calendar: "calendar",
};

/** A local date as `YYYY-MM-DD` (how date cells are stored). */
function dayKey(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const END_WIDTH = 40;
/** Width of the first column, in the left margin (the rows' drag handles). */
const GRIP_WIDTH = 24;

/** States handed over by whoever just created a database, so its view needn't fetch. */
const primed = new Map<string, DatabaseState>();
export function primeState(state: DatabaseState): void {
	primed.set(state.id, state);
}

/** Events that must not reach the editor around an inline database. */
const ISOLATED = [
	"keydown",
	"keyup",
	"keypress",
	"beforeinput",
	"input",
	"paste",
	"copy",
	"cut",
	"drop",
	"dragstart",
	"dragover",
	"compositionstart",
	"compositionupdate",
	"compositionend",
	"mousedown",
	"pointerdown",
	"click",
	"dblclick",
];

function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text?: string,
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function withIcon<T extends HTMLElement>(el: T, name: IconName, text: string, size = 14): T {
	el.insertAdjacentHTML("beforeend", icon(name, size));
	el.append(h("span", "", text));
	return el;
}

export function pill(option: SelectOption): HTMLElement {
	const el = h("span", "db-pill", option.name);
	el.dataset.color = option.color;
	return el;
}

function safeHref(url: string): string | null {
	const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
	return /^(https?|mailto):/i.test(href) ? href : null;
}

function formatTime(ms: number): string {
	return new Date(ms).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** A person: their initial in a circle, and their email. */
export function personChip(email: string): HTMLElement {
	const chip = h("span", "db-person");
	chip.title = email;
	chip.append(h("span", "db-avatar", (email[0] ?? "?").toUpperCase()), h("span", "", email));
	return chip;
}

/** Where a file in a Files & media cell is served: images inline, the rest downloaded by name. */
const fileHref = (file: FileRef) =>
	file.key.startsWith("img/")
		? `/files/${file.key}`
		: `/files/${file.key}?name=${encodeURIComponent(file.name)}`;

function fileChip(file: FileRef): HTMLElement {
	const link = h("a", "db-file");
	link.href = fileHref(file);
	link.target = "_blank";
	link.rel = "noopener";
	link.title = file.name;
	if (file.key.startsWith("img/")) {
		const img = h("img", "db-file-thumb");
		img.src = link.href;
		img.alt = "";
		img.loading = "lazy";
		link.append(img);
	} else {
		link.insertAdjacentHTML("beforeend", icon("paperclip", 13));
	}
	link.append(h("span", "", file.name));
	return link;
}

/** Uploads a file for a Files & media cell: an image if it's one we show, else an attachment. */
async function uploadFile(file: File): Promise<FileRef | null> {
	const image = ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
	const body = new FormData();
	body.append("file", file);
	try {
		const res = await fetch(image ? "/files" : "/files/attach", { method: "POST", body });
		if (!res.ok) throw new Error(`upload failed: ${res.status}`);
		const { key } = (await res.json()) as { key: string };
		return { key, name: file.name.slice(0, 200) || "file" };
	} catch (error) {
		console.warn("[upload]", error);
		void alertDialog(`Couldn't upload “${file.name}”`, "Check your connection and try again.");
		return null;
	}
}

function formatDate(value: string): string {
	const date = new Date(`${value}T00:00:00`);
	return Number.isNaN(date.getTime())
		? value
		: date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface DatabaseInfo {
	id: string;
	title: string;
	hostId: string | null;
}

class OpError extends Error {
	constructor(readonly status: number) {
		super(`database op failed: ${status}`);
	}
}

export class DatabaseView extends HTMLElement {
	#state: DatabaseState | null = null;
	#path = "";
	#queue: Promise<unknown> = Promise.resolve();
	/** The cell being edited in place; redraws wait until it's done. */
	#editing = false;
	#stale = false;
	#pop = new Popover();
	/** Rows added here: shown even when the filters would hide them, until the page reloads. */
	#keep = new Set<string>();
	/** A view change not yet confirmed by the server; replies to older requests don't undo it. */
	#localView: View | null = null;
	/** The view this reader picked (remembered per database in this browser). */
	#viewId: string | null = null;
	#viewTimer = 0;
	#viewSeq = 0;
	#started = false;
	#onShared = (event: Event) => {
		const state = (event as CustomEvent<DatabaseState>).detail;
		if (event.target !== this && state.id === this.dataset.id) this.#adopt(state, false);
	};

	/** Another database changed in a way that shows here (the other side of a relation). */
	/**
	 * Another database on this page changed. Reload if it shows here: the other
	 * side of a relation, or a database a rollup here reads from.
	 */
	#onDirty = (event: Event) => {
		const { source, ids } = (event as CustomEvent<{ source: string; ids: string[] }>).detail;
		if (source === this.#id) return;
		const readsFrom = new Set([this.#id]);
		for (const column of this.#state?.columns ?? []) {
			if (column.type === "rollup") {
				const relation = this.#state?.columns.find((c) => c.id === column.rollup?.relationId);
				if (relation?.relation) readsFrom.add(relation.relation.databaseId);
			}
		}
		if (ids.some((id) => readsFrom.has(id))) void this.op({ op: "get" }, { share: false });
	};

	get #id(): string {
		return this.dataset.id ?? "";
	}

	connectedCallback(): void {
		document.addEventListener("cf-database-state", this.#onShared);
		document.addEventListener("cf-database-dirty", this.#onDirty);
		if (this.#started) return;
		this.#started = true;
		this.#path = this.closest<HTMLElement>("[data-db-path]")?.dataset.dbPath ?? "";
		if (this.closest("notes-editor")) {
			for (const type of ISOLATED) this.addEventListener(type, (e) => e.stopPropagation());
		}
		this.addEventListener("click", (e) => this.#onClick(e));

		try {
			this.#viewId = localStorage.getItem(`cfnotes:view:${this.#id}`);
		} catch {}
		const initial = this.dataset.state ?? "";
		this.removeAttribute("data-state");
		const state = primed.get(this.#id) ?? (initial ? (JSON.parse(initial) as DatabaseState) : null);
		primed.delete(this.#id);
		if (state) this.#adopt(state, false);
		else void this.op({ op: "get" }, { share: false });
	}

	disconnectedCallback(): void {
		document.removeEventListener("cf-database-state", this.#onShared);
		document.removeEventListener("cf-database-dirty", this.#onDirty);
		this.#pop.close();
	}

	/** Sends a change; resolves with the reply (or `null` when it failed). */
	async op(
		body: Record<string, unknown>,
		{ share = true, refreshPop = true }: { share?: boolean; refreshPop?: boolean } = {},
	): Promise<Record<string, unknown> | null> {
		const run = async () => {
			const res = await fetch(location.pathname + this.#path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ databaseId: this.#id, ...body }),
			});
			if (!res.ok) throw new OpError(res.status);
			const data = (await res.json()) as { state: DatabaseState | null; touched?: string[] };
			if (data.state) this.#adopt(data.state, share, refreshPop);
			else this.#missing();
			// Tell other databases on the page (relations' other sides, rollups reading this one).
			if (body.op !== "get") {
				const ids = [this.#id, ...(data.touched ?? [])];
				document.dispatchEvent(
					new CustomEvent("cf-database-dirty", { detail: { source: this.#id, ids } }),
				);
			}
			return data as Record<string, unknown>;
		};
		const next = this.#queue.then(run, run);
		this.#queue = next.catch(() => {});
		try {
			return await next;
		} catch (error) {
			console.warn(error);
			if (error instanceof OpError && error.status === 404) this.#missing();
			else if (!(error instanceof OpError) || error.status >= 500) {
				void alertDialog("That didn't save", "Check your connection and try again.");
			}
			this.#render();
			return null;
		}
	}

	#adopt(state: DatabaseState, share: boolean, refreshPop = true) {
		const before = this.#state;
		const local = this.#localView;
		this.#state = local
			? { ...state, views: state.views.map((v) => (v.id === local.id ? local : v)) }
			: state;
		// Keep link titles current for rows and inline databases (they're not in the sidebar).
		const gone = new Set(before?.rows.map((r) => r.id));
		for (const row of state.rows) {
			gone.delete(row.id);
			setIndexTitle(row.id, row.title);
		}
		for (const id of gone) setIndexTitle(id, null);
		for (const [id, title] of Object.entries(state.titles ?? {})) setIndexTitle(id, title);
		// Relation menus name the related database; have the list ready.
		if (!this.#databaseList && state.columns.some((c) => c.type === "relation")) {
			this.#databaseList = [];
			void this.#databases();
		}
		if (state.hostId) setIndexTitle(state.id, state.title);
		// Other views of the same database on this page (a row's properties, a second embed).
		if (share) {
			this.dispatchEvent(new CustomEvent("cf-database-state", { detail: state, bubbles: true }));
		}
		this.#render(refreshPop);
	}

	/** Shows a new view at once and saves it (after a pause while typing in a filter). */
	#setView(view: View, typing = false) {
		if (!this.#state) return;
		this.#localView = view;
		this.#state = {
			...this.#state,
			views: this.#state.views.map((v) => (v.id === view.id ? view : v)),
		};
		this.#render(!typing);
		clearTimeout(this.#viewTimer);
		const seq = ++this.#viewSeq;
		this.#viewTimer = window.setTimeout(
			() => {
				void this.op({ op: "setView", view }, { refreshPop: false }).finally(() => {
					if (seq === this.#viewSeq) this.#localView = null;
				});
			},
			typing ? 400 : 0,
		);
	}

	/** The view being shown. */
	get #view(): View {
		const views = this.#state?.views ?? [];
		return views.find((v) => v.id === this.#viewId) ?? views[0] ?? emptyView();
	}

	#pickView(id: string) {
		this.#viewId = id;
		try {
			localStorage.setItem(`cfnotes:view:${this.#id}`, id);
		} catch {}
		this.#pop.close();
		this.#render();
	}

	#viewContext(): ViewContext {
		return {
			state: () => this.#state,
			view: () => this.#view,
			pop: this.#pop,
			setView: (view, typing) => this.#setView(view, typing),
			find: (selector) => this.querySelector<HTMLElement>(selector),
			typeIcon: (column) => TYPE_ICONS[column.type],
		};
	}

	#missing() {
		// Links to the database and its rows now point nowhere.
		for (const row of this.#state?.rows ?? []) setIndexTitle(row.id, null);
		if (this.#state?.hostId) setIndexTitle(this.#state.id, null);
		this.#state = null;
		this.replaceChildren(h("div", "db-missing", "This database was deleted."));
	}

	#render(refreshPop = true) {
		if (this.#editing) {
			this.#stale = true;
			return;
		}
		this.#stale = false;
		const state = this.#state;
		if (!state) return;
		if (this.dataset.row) this.#renderRecord(state, this.dataset.row);
		else this.#renderTable(state);
		if (refreshPop) this.#pop.refresh();
	}

	// ---------- table ----------

	#renderTable(state: DatabaseState) {
		const scrollLeft = this.querySelector(".db-scroll")?.scrollLeft ?? 0;
		const root = h("div", "db");

		if (!("full" in this.dataset)) {
			const head = h("div", "db-head");
			const title = h("input", "db-title");
			title.value = state.title;
			title.placeholder = "Untitled";
			title.maxLength = 200;
			title.setAttribute("aria-label", "Database title");
			const commit = () => {
				if (title.value.trim() !== state.title.trim())
					void this.op({ op: "rename", title: title.value });
			};
			title.addEventListener("change", commit);
			title.addEventListener("keydown", (e) => {
				if (e.key === "Enter") title.blur();
			});
			const more = h("button", "db-icon-btn db-more");
			more.type = "button";
			more.title = "Database options";
			more.setAttribute("aria-label", "Database options");
			more.innerHTML = icon("dots");
			head.append(withIcon(h("span", "db-head-icon"), "table", "", 16), title, more);
			root.append(head);
		}
		// View tabs, then the view's tools.
		const strip = h("div", "db-strip");
		strip.append(this.#tabs(state), h("span", "db-head-space"));
		if (this.#view.layout === "board") strip.append(this.#groupButton(state));
		if (this.#view.layout === "calendar") strip.append(this.#dateButton(state));
		strip.append(toolbar(this.#viewContext()));
		root.append(strip);
		const bar = viewBar(this.#viewContext());
		if (bar) root.append(bar);

		const layout = this.#view.layout;
		if (layout !== "table") {
			const boardScroll = this.querySelector(".db-board")?.scrollLeft ?? 0;
			const body =
				layout === "board"
					? this.#board(state)
					: layout === "list"
						? this.#list(state)
						: layout === "gallery"
							? this.#gallery(state)
							: this.#calendar(state);
			root.append(body);
			this.replaceChildren(root);
			if (layout === "board") body.scrollLeft = boardScroll;
			return;
		}

		const scroll = h("div", "db-scroll");
		const table = h("table", "db-table");
		// Exact column widths (the table doesn't stretch them to fill the space).
		const colgroup = h("colgroup");
		// A narrow first column holds the rows' drag handles (in the left margin).
		const gripCol = h("col");
		gripCol.style.width = `${GRIP_WIDTH}px`;
		colgroup.append(gripCol);
		for (const column of state.columns) {
			const col = h("col");
			col.dataset.col = column.id;
			col.style.width = `${columnWidth(column)}px`;
			colgroup.append(col);
		}
		const lastCol = h("col");
		lastCol.style.width = `${END_WIDTH}px`;
		colgroup.append(lastCol);
		table.append(colgroup);
		this.#fitTable(table);

		const headRow = h("tr");
		headRow.append(h("th", "db-grip-cell"));
		for (const column of state.columns) {
			const th = h("th", "db-th");
			th.dataset.col = column.id;
			const button = h("button", "db-th-btn");
			button.type = "button";
			withIcon(button, TYPE_ICONS[column.type], column.name);
			th.append(button, this.#resizeHandle(column));
			this.#columnDrag(th, column.id);
			headRow.append(th);
		}
		const addTh = h("th", "db-th db-th-add");
		const addCol = h("button", "db-icon-btn db-add-col");
		addCol.type = "button";
		addCol.title = "Add a property";
		addCol.setAttribute("aria-label", "Add a property");
		addCol.innerHTML = icon("plus");
		addTh.append(addCol);
		headRow.append(addTh);
		table.append(h("thead"));
		table.tHead!.append(headRow);

		const body = h("tbody");
		const rows = applyView(state.columns, state.rows, this.#view, this.#keep, state.titles);
		// Sorts decide the order, so rows can only be dragged when there are none.
		const draggable = this.#view.sorts.length === 0;
		if (!draggable) table.classList.add("is-sorted");
		if (rows.length === 0 && state.rows.length > 0) {
			const tr = h("tr");
			tr.append(h("td", "db-grip-cell"));
			const td = h("td", "db-no-results", "No rows match these filters.");
			td.colSpan = state.columns.length + 1;
			tr.append(td);
			body.append(tr);
		}
		// Row numbers (the database's own order, which `[row:column]` counts in)
		// show once there are formulas or scripts to write.
		const position = new Map(state.rows.map((row, i) => [row.id, i + 1]));
		if (
			state.columns.some((c) => c.type === "script") ||
			state.rows.some((row) => row.formulas && Object.keys(row.formulas).length > 0)
		)
			table.classList.add("has-formulas");
		for (const row of rows) {
			const tr = h("tr", "db-tr");
			tr.dataset.row = row.id;
			const gripCell = h("td", "db-grip-cell");
			gripCell.append(h("span", "db-rownum", String(position.get(row.id))));
			if (draggable) gripCell.append(this.#rowGrip(tr, row));
			tr.append(gripCell);
			for (const column of state.columns) tr.append(this.#cell(column, row));
			const end = h("td", "db-td-end");
			const more = h("button", "db-icon-btn db-row-more");
			more.type = "button";
			more.title = "Row options";
			more.setAttribute("aria-label", "Row options");
			more.innerHTML = icon("dots");
			end.append(more);
			tr.append(end);
			body.append(tr);
		}
		table.append(body);
		if (draggable) this.#rowDrop(body);
		scroll.append(table);

		const addRow = withIcon(h("button", "db-add-row"), "plus", "New");
		addRow.type = "button";
		root.append(scroll, addRow);
		this.replaceChildren(root);
		scroll.scrollLeft = scrollLeft;
	}

	// ---------- dragging rows and columns ----------

	/** A row's drag handle. Alt+↑/↓ on it moves the row too. */
	#rowGrip(tr: HTMLElement, row: Row): HTMLElement {
		const grip = h("button", "db-grip");
		grip.type = "button";
		grip.draggable = true;
		grip.title = "Drag to move";
		grip.setAttribute("aria-label", `Move ${row.title.trim() || "Untitled"} (Alt+↑ or Alt+↓)`);
		grip.innerHTML = icon("gripVertical", 14);
		grip.addEventListener("dragstart", (e) => {
			if (!e.dataTransfer) return;
			e.dataTransfer.setData("text/x-cf-row", row.id);
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setDragImage(tr, 12, 12);
			this.#dragRow = row.id;
			tr.classList.add("is-dragging");
		});
		grip.addEventListener("dragend", () => {
			this.#dragRow = null;
			tr.classList.remove("is-dragging");
			this.#clearDropMarks();
		});
		grip.addEventListener("keydown", (e) => {
			if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
			e.preventDefault();
			const target = e.key === "ArrowUp" ? tr.previousElementSibling : tr.nextElementSibling;
			if (!(target instanceof HTMLElement) || !target.dataset.row) return;
			this.#moveRowTo(row.id, target, e.key === "ArrowDown");
		});
		return grip;
	}

	/** Dropping a row on another: before it (top half) or after it (bottom half), marked by a line. */
	#rowDrop(body: HTMLElement) {
		const target = (e: DragEvent) => {
			const tr = (e.target as Element).closest<HTMLElement>(".db-tr");
			if (!tr || tr.dataset.row === this.#dragRow) return null;
			const box = tr.getBoundingClientRect();
			return { tr, after: e.clientY > box.top + box.height / 2 };
		};
		const accepts = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("text/x-cf-row"));
		body.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			const at = target(e);
			this.#clearDropMarks();
			at?.tr.classList.add(at.after ? "drop-after" : "drop-before");
		});
		body.addEventListener("dragleave", (e) => {
			if (!body.contains(e.relatedTarget as Node)) this.#clearDropMarks();
		});
		body.addEventListener("drop", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			const at = target(e);
			this.#clearDropMarks();
			const rowId = this.#dragRow ?? e.dataTransfer!.getData("text/x-cf-row");
			if (at && rowId) this.#moveRowTo(rowId, at.tr, at.after);
		});
	}

	/** Moves a row next to the row shown in `tr` (in the stored order, which unsorted tables show). */
	#moveRowTo(rowId: string, tr: HTMLElement, after: boolean) {
		const state = this.#state;
		const row = state?.rows.find((r) => r.id === rowId);
		const targetId = tr.dataset.row;
		if (!state || !row || !targetId || targetId === rowId) return;
		const rest = state.rows.filter((r) => r.id !== rowId);
		const at = rest.findIndex((r) => r.id === targetId) + (after ? 1 : 0);
		const rows = rest.toSpliced(at, 0, row);
		// Only the shown order matters (filters can hide rows in between).
		const shown = new Set(
			[...this.querySelectorAll<HTMLElement>(".db-tr")].map((el) => el.dataset.row),
		);
		const order = (list: Row[]) =>
			list
				.filter((r) => shown.has(r.id))
				.map((r) => r.id)
				.join();
		if (order(rows) === order(state.rows)) return;
		const beforeId = rows[at + 1]?.id ?? null;
		this.#state = { ...state, rows };
		this.#render();
		void this.op({ op: "moveRow", rowId, beforeId }).then(() =>
			this.querySelector<HTMLElement>(`.db-tr[data-row="${CSS.escape(rowId)}"] .db-grip`)?.focus(),
		);
	}

	/** Column headers drag sideways; a line marks the spot (left or right of a header). */
	#columnDrag(th: HTMLElement, columnId: string) {
		th.draggable = true;
		th.addEventListener("dragstart", (e) => {
			// Dragging the resize edge resizes instead.
			if (this.classList.contains("is-resizing") || !e.dataTransfer) return e.preventDefault();
			e.dataTransfer.setData("text/x-cf-col", columnId);
			e.dataTransfer.effectAllowed = "move";
			this.#dragCol = columnId;
			th.classList.add("is-dragging");
		});
		th.addEventListener("dragend", () => {
			this.#dragCol = null;
			th.classList.remove("is-dragging");
			this.#clearDropMarks();
		});
		const side = (e: DragEvent) => {
			const box = th.getBoundingClientRect();
			return e.clientX > box.left + box.width / 2 ? "after" : "before";
		};
		const accepts = (e: DragEvent) =>
			Boolean(e.dataTransfer?.types.includes("text/x-cf-col")) && this.#dragCol !== columnId;
		th.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			this.#clearDropMarks();
			const mark = side(e) === "after" ? "drop-right" : "drop-left";
			for (const el of this.querySelectorAll(`[data-col="${CSS.escape(columnId)}"]`)) {
				if (el.matches("th, td")) el.classList.add(mark);
			}
		});
		th.addEventListener("drop", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			this.#clearDropMarks();
			const dragged = this.#dragCol ?? e.dataTransfer!.getData("text/x-cf-col");
			this.#moveColumnTo(dragged, columnId, side(e) === "after");
		});
	}

	#dragCol: string | null = null;

	#moveColumnTo(columnId: string, targetId: string, after: boolean) {
		const state = this.#state;
		const column = state?.columns.find((c) => c.id === columnId);
		if (!state || !column || columnId === targetId) return;
		const rest = state.columns.filter((c) => c.id !== columnId);
		const at = rest.findIndex((c) => c.id === targetId) + (after ? 1 : 0);
		const columns = rest.toSpliced(at, 0, column);
		if (columns.every((c, i) => c === state.columns[i])) return;
		const beforeId = columns[at + 1]?.id ?? null;
		this.#state = { ...state, columns };
		this.#render();
		void this.op({ op: "moveColumn", columnId, beforeId });
	}

	#clearDropMarks() {
		for (const el of this.querySelectorAll(".drop-before, .drop-after, .drop-left, .drop-right")) {
			el.classList.remove("drop-before", "drop-after", "drop-left", "drop-right");
		}
	}

	/** Sets the table's width to the sum of its columns (fixed layout needs one). */
	#fitTable(table: HTMLTableElement) {
		let total = 0;
		for (const col of table.querySelectorAll("col")) total += parseFloat(col.style.width) || 0;
		table.style.width = `${total}px`;
	}

	/** The drag handle on a header's right edge. Double-click resets; arrow keys nudge. */
	#resizeHandle(column: Column): HTMLElement {
		const handle = h("span", "db-resize");
		handle.setAttribute("role", "separator");
		handle.setAttribute("aria-orientation", "vertical");
		handle.setAttribute("aria-label", `Resize ${column.name}`);
		handle.setAttribute("aria-valuenow", String(columnWidth(column)));
		handle.tabIndex = 0;
		const colEl = () =>
			this.querySelector<HTMLTableColElement>(`col[data-col="${CSS.escape(column.id)}"]`);
		const save = (width: number | null) =>
			void this.op({ op: "resizeColumn", columnId: column.id, width });

		handle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const col = colEl();
			const table = col?.closest("table");
			if (!col || !table) return;
			const startX = event.clientX;
			const start = parseFloat(col.style.width) || columnWidth(column);
			let width = start;
			handle.setPointerCapture(event.pointerId);
			this.classList.add("is-resizing");
			const move = (e: PointerEvent) => {
				width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, start + e.clientX - startX)));
				col.style.width = `${width}px`;
				this.#fitTable(table);
			};
			const up = () => {
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", up);
				handle.removeEventListener("pointercancel", up);
				this.classList.remove("is-resizing");
				if (width !== start) save(width);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up);
			handle.addEventListener("pointercancel", up);
		});
		handle.addEventListener("click", (event) => event.stopPropagation());
		handle.addEventListener("dblclick", (event) => {
			event.stopPropagation();
			if (column.width !== undefined) save(null);
		});
		handle.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			const step = event.key === "ArrowLeft" ? -20 : 20;
			save(columnWidth(column) + step);
		});
		return handle;
	}

	/** A table cell (or a property value) for `row` in `column`. */
	#cell(column: Column, row: Row, tag: "td" | "div" = "td"): HTMLElement {
		const cell = h(tag, `db-td db-type-${column.type}`);
		cell.dataset.row = row.id;
		cell.dataset.col = column.id;
		this.#fill(cell, column, row);
		return cell;
	}

	#fill(cell: HTMLElement, column: Column, row: Row) {
		cell.replaceChildren();
		if (column.type === "title") {
			cell.append(h("span", "db-text", row.title));
			const open = withIcon(h("a", "db-open"), "arrowUpRight", "Open", 13);
			open.href = `/p/${row.id}`;
			cell.append(open);
			return;
		}
		if (row.formulas?.[column.id] && canHoldFormula(column)) {
			this.#fillComputed(cell, row.cells[column.id], false);
			cell.classList.add("has-formula");
			if (cell.childElementCount === 0 && "row" in this.dataset)
				cell.append(h("span", "db-empty", "Empty"));
			return;
		}
		cell.classList.remove("has-formula");
		const value = readCell(column, row.cells[column.id]);
		switch (column.type) {
			case "text":
			case "number":
				if (typeof value === "string" || typeof value === "number") {
					cell.append(h("span", "db-text", String(value)));
				}
				break;
			case "email":
			case "phone":
				if (typeof value === "string" && value) {
					const link = h("a", "db-text db-url", value);
					link.href =
						column.type === "email" ? `mailto:${value}` : `tel:${value.replace(/[^\d+]/g, "")}`;
					cell.append(link);
				}
				break;
			case "person":
			case "created_by":
			case "last_edited_by":
				for (const email of value as string[]) cell.append(personChip(email));
				break;
			case "files":
				for (const file of value as FileRef[]) cell.append(fileChip(file));
				break;
			case "created_time":
			case "last_edited_time":
				if (typeof value === "number") cell.append(h("span", "db-text", formatTime(value)));
				break;
			case "url":
				if (typeof value === "string") {
					const href = safeHref(value);
					const link = h(href ? "a" : "span", "db-text db-url", value);
					if (href && link instanceof HTMLAnchorElement) {
						link.href = href;
						link.target = "_blank";
						link.rel = "noopener noreferrer";
					}
					cell.append(link);
				}
				break;
			case "date":
				if (typeof value === "string") cell.append(h("span", "db-text", formatDate(value)));
				break;
			case "checkbox": {
				const box = h("span", `db-check${value ? " is-on" : ""}`);
				box.setAttribute("role", "checkbox");
				box.setAttribute("aria-checked", String(Boolean(value)));
				if (value) box.innerHTML = icon("check", 12, 3);
				cell.append(box);
				break;
			}
			case "select":
			case "status":
				if (value) cell.append(pill(value as SelectOption));
				break;
			case "multi_select":
				for (const option of value as SelectOption[]) cell.append(pill(option));
				break;
			case "relation":
				for (const id of value as string[]) cell.append(this.#relatedChip(id));
				break;
			case "rollup": {
				const text = this.#rollupText(column, value);
				if (text) cell.append(h("span", "db-text", text));
				break;
			}
			case "script":
				this.#fillComputed(cell, value, column.script?.kind === "date");
				break;
		}
		if (cell.childElementCount === 0 && "row" in this.dataset) {
			cell.append(h("span", "db-empty", "Empty"));
		}
	}

	/** A worked-out value (a script's or a formula's): a number, text, a date, a yes/no, a list, or an error. */
	#fillComputed(cell: HTMLElement, value: unknown, isDate: boolean) {
		if (isScriptError(value)) {
			const error = h("span", "db-script-error", `⚠ ${value.$error}`);
			error.title = value.$error;
			cell.append(error);
		} else if (typeof value === "boolean") {
			const box = h("span", `db-check is-readonly${value ? " is-on" : ""}`);
			box.setAttribute("role", "checkbox");
			box.setAttribute("aria-checked", String(value));
			box.setAttribute("aria-readonly", "true");
			if (value) box.innerHTML = icon("check", 12, 3);
			cell.append(box);
		} else if (isDate && typeof value === "string") {
			cell.append(h("span", "db-text", formatDate(value)));
		} else {
			const text = scriptText(value);
			if (text)
				cell.append(h("span", `db-text${typeof value === "number" ? " db-number" : ""}`, text));
		}
	}

	// ---------- a row's properties ----------

	#renderRecord(state: DatabaseState, rowId: string) {
		const row = state.rows.find((r) => r.id === rowId);
		if (!row) return this.replaceChildren();
		const list = h("div", "db-props");
		for (const column of state.columns) {
			if (column.type === "title") continue;
			const item = h("div", "db-prop");
			const name = h("button", "db-prop-name");
			name.type = "button";
			name.dataset.col = column.id;
			withIcon(name, TYPE_ICONS[column.type], column.name);
			item.append(name, this.#cell(column, row, "div"));
			list.append(item);
		}
		const add = withIcon(h("button", "db-add-prop db-add-col"), "plus", "Add a property");
		add.type = "button";
		list.append(add);
		this.replaceChildren(list);
	}

	// ---------- interaction ----------

	#onClick(event: MouseEvent) {
		const target = event.target as Element;
		if (target.closest("a[href]")) return; // Open, URLs
		const state = this.#state;
		if (!state) return;
		const header = target.closest<HTMLElement>(".db-th[data-col] .db-th-btn, .db-prop-name");
		if (header) {
			const id = header.closest<HTMLElement>("[data-col]")!.dataset.col!;
			return this.#columnMenu(id, header);
		}
		const button = target.closest<HTMLElement>("button");
		if (button?.classList.contains("db-add-col")) return this.#addColumnMenu(button);
		if (button?.classList.contains("db-add-row")) return void this.#addRow();
		if (button?.classList.contains("db-more")) return this.#databaseMenu(button);
		if (button?.classList.contains("db-row-more")) {
			return this.#rowMenu(button.closest<HTMLElement>("[data-row]")!.dataset.row!, button);
		}
		const cell = target.closest<HTMLElement>(".db-td[data-col]");
		if (cell && !cell.classList.contains("is-editing")) this.#edit(cell);
	}

	#find(rowId: string, columnId: string) {
		const state = this.#state;
		const row = state?.rows.find((r) => r.id === rowId);
		const column = state?.columns.find((c) => c.id === columnId);
		return row && column ? { row, column } : null;
	}

	#cellEl(rowId: string, columnId: string) {
		return this.querySelector<HTMLElement>(
			`.db-td[data-row="${CSS.escape(rowId)}"][data-col="${CSS.escape(columnId)}"]`,
		);
	}

	/** The next (or previous) cell in reading order, for Tab. */
	#neighbour(cell: HTMLElement, backward: boolean): HTMLElement | null {
		const cells = [...this.querySelectorAll<HTMLElement>(".db-td[data-col]")];
		return cells[cells.indexOf(cell) + (backward ? -1 : 1)] ?? null;
	}

	#edit(cell: HTMLElement) {
		const found = this.#find(cell.dataset.row!, cell.dataset.col!);
		if (!found) return;
		const { row, column } = found;
		switch (column.type) {
			case "checkbox":
				void this.op({
					op: "setCell",
					rowId: row.id,
					columnId: column.id,
					value: !readCell(column, row.cells[column.id]),
				});
				return;
			case "select":
			case "status":
			case "multi_select":
				return this.#selectMenu(row.id, column.id, cell);
			case "person":
				return this.#personMenu(row.id, column.id, cell);
			case "files":
				return this.#filesMenu(row.id, column.id, cell);
			case "relation":
				return this.#relationMenu(row.id, column.id, cell);
			case "rollup":
			case "script":
			case "created_time":
			case "created_by":
			case "last_edited_time":
			case "last_edited_by":
				return; // computed
			default:
				return this.#editText(cell, row, column);
		}
	}

	#editText(cell: HTMLElement, row: Row, column: Column) {
		const value = column.type === "title" ? row.title : readCell(column, row.cells[column.id]);
		const formula = column.type === "title" ? undefined : row.formulas?.[column.id];
		const formulas = column.type !== "title" && canHoldFormula(column);
		const plain = typeof value === "string" || typeof value === "number" ? String(value) : "";
		// A formula shows as `=…`; text that really starts with "=" as `'=…` (as in Excel).
		const initial = formula
			? `=${formula.source}`
			: formulas && column.type === "text" && plain.startsWith("=")
				? `'${plain}`
				: plain;
		const input = h("input", "db-input");
		input.value = initial;
		if (column.type === "date") input.type = "date";
		if (column.type === "number" && !formula) input.inputMode = "decimal";
		if (column.type === "url") input.type = "url";
		if (column.type === "email") input.type = "email";
		if (column.type === "phone") input.type = "tel";
		input.maxLength = column.type === "title" ? 200 : 2000;
		input.setAttribute("aria-label", column.name);
		input.spellcheck = !formula;
		cell.replaceChildren(input);
		cell.classList.add("is-editing");
		this.#editing = true;
		input.focus();
		// Date and email inputs have no caret to place.
		if (input.type !== "date" && input.type !== "email")
			input.setSelectionRange(initial.length, initial.length);
		const pointing = formulas ? this.#formulaMode(cell, input, row, column) : null;

		let done = false;
		const finish = (save: boolean, then?: HTMLElement | null) => {
			if (done) return;
			done = true;
			pointing?.stop();
			this.#editing = false;
			cell.classList.remove("is-editing", "is-formula");
			const next = input.value;
			const changed = save && next !== initial;
			if (changed) {
				if (column.type === "title") void this.op({ op: "setTitle", rowId: row.id, title: next });
				else if (formulas && next.startsWith("="))
					void this.#saveFormula(row.id, column.id, next.slice(1));
				else
					void this.op({
						op: "setCell",
						rowId: row.id,
						columnId: column.id,
						value: formulas && next.startsWith("'=") ? next.slice(1) : next,
					});
			}
			if (then) {
				this.#edit(then);
			} else if (this.#stale || !changed || (formulas && next.startsWith("="))) {
				this.#render();
			} else {
				// Show the new text right away; the reply redraws with the stored value.
				const { [column.id]: _, ...rest } = row.formulas ?? {};
				this.#fill(cell, column, {
					...row,
					title: column.type === "title" ? next : row.title,
					cells: { ...row.cells, [column.id]: next },
					formulas: rest,
				});
			}
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				finish(true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				finish(false);
			} else if (e.key === "Tab") {
				e.preventDefault();
				finish(true, this.#neighbour(cell, e.shiftKey));
			}
		});
		input.addEventListener("blur", () => finish(true));
	}

	/** Compiles a formula (TypeScript, in the browser) and saves it; the reply has its result. */
	async #saveFormula(rowId: string, columnId: string, source: string) {
		const { compileFormula } = await import("./script-engine.ts");
		const compiled = compileFormula(source);
		await this.op({ op: "setCell", rowId, columnId, value: { $formula: compiled } });
	}

	/**
	 * While a cell's input starts with "=": a bar under it with the cell's
	 * address and how references work, and clicking another cell (or a column's
	 * header) types its reference instead of leaving, as in a spreadsheet.
	 */
	#formulaMode(cell: HTMLElement, input: HTMLInputElement, row: Row, column: Column) {
		const state = this.#state!;
		const rowNumber = state.rows.findIndex((r) => r.id === row.id) + 1;
		const colNumber = state.columns.findIndex((c) => c.id === column.id) + 1;
		const hint = h("div", "db-formula-hint");
		hint.hidden = true;
		const where = h("div", "db-formula-where");
		where.append(
			h("code", "", `[${rowNumber}:${colNumber}]`),
			h("span", "", ` row ${rowNumber} · ${column.name}`),
		);
		const how = h("div", "db-formula-how");
		for (const [code, text] of [
			["[@:Price]", "this row"],
			["[-1:@]", "the cell above"],
			["[!:Price]", "the whole column"],
			["[1..-1:@]", "everything above"],
			["sum avg min max count round", ""],
		] as const) {
			how.append(h("code", "", code));
			if (text) how.append(h("span", "", text));
		}
		hint.append(
			where,
			how,
			h("div", "db-formula-tip", "Click a cell to insert it · Enter to save"),
		);
		document.body.append(hint);

		const place = () => {
			const rect = cell.getBoundingClientRect();
			hint.style.top = `${rect.bottom + 4}px`;
			hint.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - hint.offsetWidth - 8))}px`;
		};
		const sync = () => {
			const on = input.value.startsWith("=");
			cell.classList.toggle("is-formula", on);
			this.classList.toggle("is-pointing", on);
			input.spellcheck = !on;
			if (on === !hint.hidden) return;
			hint.hidden = !on;
			if (on) place();
		};
		const name = (c: Column) =>
			/^[A-Za-z_$][\w$]*$/.test(c.name) ? c.name : JSON.stringify(c.name);
		const insert = (text: string) => {
			const { selectionStart: a, selectionEnd: b, value } = input;
			const at = a ?? value.length;
			input.value = value.slice(0, at) + text + value.slice(b ?? at);
			input.setSelectionRange(at + text.length, at + text.length);
			input.focus();
		};
		const refFor = (target: Element): string | null => {
			const header = target.closest<HTMLElement>(".db-th[data-col]");
			const other = target.closest<HTMLElement>(".db-td[data-col][data-row]");
			const colId = (header ?? other)?.dataset.col;
			const c = state.columns.find((x) => x.id === colId);
			if (!c) return null;
			const colPart = c.id === column.id ? "@" : name(c);
			if (header) return `[!:${colPart}]`;
			if (!other || other === cell) return null;
			const r = state.rows.findIndex((x) => x.id === other.dataset.row);
			if (r < 0) return null;
			return `[${other.dataset.row === row.id ? "@" : r + 1}:${colPart}]`;
		};
		const onDown = (event: MouseEvent) => {
			if (!input.value.startsWith("=")) return;
			const ref = refFor(event.target as Element);
			if (!ref) return;
			event.preventDefault();
			event.stopPropagation();
			insert(ref);
		};
		// The click that follows mustn't open that cell (or the column's menu).
		const onClick = (event: MouseEvent) => {
			if (!input.value.startsWith("=") || !refFor(event.target as Element)) return;
			event.preventDefault();
			event.stopPropagation();
		};
		this.addEventListener("mousedown", onDown, true);
		this.addEventListener("click", onClick, true);
		input.addEventListener("input", sync);
		addEventListener("scroll", place, true);
		sync();
		return {
			stop: () => {
				this.removeEventListener("mousedown", onDown, true);
				this.removeEventListener("click", onClick, true);
				removeEventListener("scroll", place, true);
				this.classList.remove("is-pointing");
				hint.remove();
			},
		};
	}

	/** Adds a row (pre-filled to match the view, plus `extra`) and starts naming it. */
	async #addRow(extra: Record<string, unknown> = {}) {
		const state = this.#state;
		if (!state) return;
		// Fill in what the filters ask for, so the new row belongs in this view.
		const values = prefill(state.columns, this.#view);
		const cells = { ...values.cells, ...extra };
		const reply = await this.op({ op: "addRow", title: values.title, cells });
		const id = typeof reply?.rowId === "string" ? reply.rowId : null;
		if (!id) return;
		this.#keep.add(id);
		this.#render();
		const cell = this.#cellEl(id, TITLE_COLUMN);
		if (cell) return this.#edit(cell);
		const card = this.querySelector<HTMLElement>(
			`:is(.db-card, .db-item)[data-row="${CSS.escape(id)}"]`,
		);
		if (card) this.#nameCard(card, id);
	}

	// ---------- views ----------

	/** One tab per view; clicking the current one opens its menu. */
	#tabs(state: DatabaseState): HTMLElement {
		const tabs = h("div", "db-tabs");
		tabs.setAttribute("role", "tablist");
		const current = this.#view;
		for (const view of state.views) {
			const tab = withIcon(
				h("button", `db-tab${view.id === current.id ? " is-active" : ""}`),
				LAYOUT_ICONS[view.layout],
				view.name,
			);
			tab.type = "button";
			tab.dataset.view = view.id;
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-selected", String(view.id === current.id));
			tab.addEventListener("click", () =>
				view.id === current.id ? this.#viewMenu(view, tab) : this.#pickView(view.id),
			);
			tabs.append(tab);
		}
		const add = h("button", "db-icon-btn db-tab-add");
		add.type = "button";
		add.title = "Add a view";
		add.setAttribute("aria-label", "Add a view");
		add.innerHTML = icon("plus", 14);
		add.addEventListener("click", () => {
			this.#pop.open(add, (panel) => {
				const make = (layout: Layout) => async () => {
					const reply = await this.op({ op: "addView", layout });
					if (typeof reply?.viewId === "string") this.#pickView(reply.viewId);
				};
				panel.append(
					this.#pop.menu([
						{ heading: "Add a view" },
						...LAYOUTS.map((layout) => ({
							label: LAYOUT_NAMES[layout],
							icon: LAYOUT_ICONS[layout],
							run: make(layout),
						})),
					]),
				);
			});
		});
		tabs.append(add);
		return tabs;
	}

	/** Rename or delete a view. */
	#viewMenu(view: View, anchor: HTMLElement) {
		let name = view.name;
		const commit = () => {
			if (name.trim() && name.trim() !== view.name) {
				void this.op({ op: "renameView", viewId: view.id, name });
			}
		};
		this.#pop.open(
			anchor,
			(panel, refocus) => {
				const input = h("input", "db-pop-input db-pop-name");
				input.value = name;
				input.maxLength = 60;
				input.setAttribute("aria-label", "View name");
				input.addEventListener("input", () => (name = input.value));
				input.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						this.#pop.close();
					}
				});
				panel.append(
					input,
					this.#pop.menu(
						[
							{
								label: "Delete view",
								icon: "trash",
								danger: true,
								disabled: (this.#state?.views.length ?? 0) < 2,
								run: async () => {
									if (await confirmDialog({ title: `Delete the “${view.name}” view?` })) {
										void this.op({ op: "deleteView", viewId: view.id });
									}
								},
							},
						],
						() => (name = view.name),
					),
				);
				refocus(input, true);
			},
			commit,
		);
	}

	/** "Group by" for a board: which select property makes the groups. */
	#groupButton(state: DatabaseState): HTMLElement {
		const group = state.columns.find((c) => c.id === this.#view.groupBy);
		const button = withIcon(
			h("button", "db-tool db-tool-group"),
			"layoutKanban",
			group ? `Group: ${group.name}` : "Group",
		);
		button.type = "button";
		button.addEventListener("click", () => {
			this.#pop.open(button, (panel) => {
				const selects = state.columns.filter((c) => canGroup(c));
				panel.append(
					this.#pop.menu([
						{
							heading: selects.length ? "Group by" : "Add a Select or Status property to group by",
						},
						...selects.map((c) => ({
							label: c.name,
							icon: TYPE_ICONS[c.type],
							checked: c.id === this.#view.groupBy,
							run: () => this.#setView({ ...this.#view, groupBy: c.id }),
						})),
					]),
				);
			});
		});
		return button;
	}

	// ---------- list, gallery, calendar ----------

	/** A row as an item that opens its page on click or Enter. */
	#item(row: Row, className: string): HTMLElement {
		const item = h("div", `db-item ${className}`);
		item.dataset.row = row.id;
		item.tabIndex = 0;
		const open = (e: Event) => {
			if ((e.target as Element).closest("a[href], input, button")) return;
			location.assign(`/p/${row.id}`);
		};
		item.addEventListener("click", open);
		item.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && e.target === item) open(e);
		});
		return item;
	}

	/** The row's emoji (or a page icon) and name; the name is `.db-card-title` so new rows can be named in place. */
	#itemTitle(row: Row): HTMLElement {
		const line = h("div", "db-item-head");
		const mark = h("span", "db-item-icon");
		if (row.icon) mark.textContent = row.icon;
		else mark.innerHTML = icon("fileText", 16);
		const title = h("span", "db-card-title", row.title.trim() || "Untitled");
		if (!row.title.trim()) title.classList.add("is-empty");
		line.append(mark, title);
		return line;
	}

	/** The row's non-empty properties (an unticked checkbox counts as empty). */
	#itemProps(row: Row, columns: Column[], className: string): HTMLElement[] {
		const props: HTMLElement[] = [];
		for (const column of columns) {
			if (column.type === "checkbox" && readCell(column, row.cells[column.id]) !== true) continue;
			const prop = h("div", `${className} db-type-${column.type}`);
			this.#fill(prop, column, row);
			if (prop.childElementCount > 0) props.push(prop);
		}
		return props;
	}

	#noMatches(state: DatabaseState, rows: Row[]): HTMLElement | null {
		return rows.length === 0 && state.rows.length > 0
			? h("div", "db-no-results", "No rows match these filters.")
			: null;
	}

	/** A list: one line per row, its name on the left and its properties on the right. */
	#list(state: DatabaseState): HTMLElement {
		const rows = applyView(state.columns, state.rows, this.#view, this.#keep, state.titles);
		const shown = state.columns.filter((c) => c.type !== "title");
		const wrap = h("div", "db-list");
		const none = this.#noMatches(state, rows);
		if (none) wrap.append(none);
		for (const row of rows) {
			const item = this.#item(row, "db-list-item");
			const props = h("div", "db-list-props");
			props.append(...this.#itemProps(row, shown, "db-list-prop"));
			item.append(this.#itemTitle(row), props);
			wrap.append(item);
		}
		const add = withIcon(h("button", "db-add-row"), "plus", "New");
		add.type = "button";
		wrap.append(add);
		return wrap;
	}

	/** A gallery: a card per row with its cover (or emoji), name and properties. */
	#gallery(state: DatabaseState): HTMLElement {
		const rows = applyView(state.columns, state.rows, this.#view, this.#keep, state.titles);
		const shown = state.columns.filter((c) => c.type !== "title");
		const wrap = h("div", "db-gallery-wrap");
		const none = this.#noMatches(state, rows);
		if (none) wrap.append(none);
		const grid = h("div", "db-gallery");
		for (const row of rows) {
			const card = this.#item(row, "db-gallery-card");
			const cover = h("div", "db-gallery-cover");
			if (row.cover?.startsWith("/files/"))
				cover.style.backgroundImage = `url(${JSON.stringify(row.cover)})`;
			else if (row.cover && /^g[1-6]$/.test(row.cover)) cover.classList.add(`cover-${row.cover}`);
			else {
				cover.classList.add("is-empty");
				if (row.icon) cover.append(h("span", "db-gallery-emoji", row.icon));
			}
			const body = h("div", "db-gallery-body");
			body.append(this.#itemTitle(row), ...this.#itemProps(row, shown, "db-card-prop"));
			card.append(cover, body);
			grid.append(card);
		}
		const add = withIcon(h("button", "db-add-row db-gallery-new"), "plus", "New");
		add.type = "button";
		grid.append(add);
		wrap.append(grid);
		return wrap;
	}

	/** The month a calendar shows (its first day); this page visit only. */
	#month: Date | null = null;

	/** "Date: …" for a calendar: which date property places rows on days. */
	#dateButton(state: DatabaseState): HTMLElement {
		const date = state.columns.find((c) => c.id === this.#view.dateBy);
		const button = withIcon(
			h("button", "db-tool db-tool-date"),
			"calendar",
			date ? `Date: ${date.name}` : "Date",
		);
		button.type = "button";
		button.addEventListener("click", () => {
			this.#pop.open(button, (panel) => {
				const dates = state.columns.filter((c) => c.type === "date");
				panel.append(
					this.#pop.menu([
						{ heading: dates.length ? "Show by" : "Add a Date property first" },
						...dates.map((c) => ({
							label: c.name,
							icon: TYPE_ICONS[c.type],
							checked: c.id === this.#view.dateBy,
							run: () => this.#setView({ ...this.#view, dateBy: c.id }),
						})),
					]),
				);
			});
		});
		return button;
	}

	/** A calendar with no date property to use yet: pick one, or make one. */
	#calendarSetup(state: DatabaseState): HTMLElement {
		const box = h("div", "db-board-setup");
		box.append(h("p", "", "A calendar places rows on the days of a Date property."));
		for (const column of state.columns.filter((c) => c.type === "date")) {
			const pick = withIcon(h("button", "db-chip"), TYPE_ICONS.date, `Use ${column.name}`);
			pick.type = "button";
			pick.addEventListener("click", () => this.#setView({ ...this.#view, dateBy: column.id }));
			box.append(pick);
		}
		const make = withIcon(h("button", "db-chip db-calendar-date"), "plus", "Add a Date property");
		make.type = "button";
		make.addEventListener("click", async () => {
			const reply = await this.op({ op: "addColumn", type: "date", name: "Date" });
			if (typeof reply?.columnId === "string")
				this.#setView({ ...this.#view, dateBy: reply.columnId });
		});
		box.append(make);
		return box;
	}

	/**
	 * A month calendar: rows sit on the day of their date property. Drag one to
	 * another day (or onto the calendar from "No date") to change its date;
	 * "+" on a day adds a row dated that day.
	 */
	#calendar(state: DatabaseState): HTMLElement {
		const view = this.#view;
		const dateCol = state.columns.find((c) => c.id === view.dateBy && c.type === "date");
		if (!dateCol) return this.#calendarSetup(state);
		const rows = applyView(state.columns, state.rows, view, this.#keep, state.titles);
		const byDay = new Map<string, Row[]>();
		const undated: Row[] = [];
		for (const row of rows) {
			const value = readCell(dateCol, row.cells[dateCol.id]);
			if (typeof value === "string") {
				const list = byDay.get(value) ?? [];
				list.push(row);
				byDay.set(value, list);
			} else undated.push(row);
		}

		const today = new Date();
		const month = this.#month ?? new Date(today.getFullYear(), today.getMonth(), 1);
		const wrap = h("div", "db-calendar");

		const head = h("div", "db-cal-head");
		head.append(
			h(
				"span",
				"db-cal-month",
				month.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
			),
		);
		const go = (label: string, iconName: IconName | null, months: number | null) => {
			const button = h("button", "db-icon-btn db-cal-nav");
			button.type = "button";
			button.title = label;
			button.setAttribute("aria-label", label);
			if (iconName) button.innerHTML = icon(iconName, 16);
			else button.textContent = label;
			button.addEventListener("click", () => {
				this.#month =
					months === null
						? new Date(today.getFullYear(), today.getMonth(), 1)
						: new Date(month.getFullYear(), month.getMonth() + months, 1);
				this.#render();
			});
			return button;
		};
		head.append(
			go("Previous month", "chevronLeft", -1),
			go("Today", null, null),
			go("Next month", "chevronRight", 1),
		);
		wrap.append(head);

		const grid = h("div", "db-cal-grid");
		const sunday = new Date(2024, 0, 7);
		for (let i = 0; i < 7; i++) {
			const day = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + i);
			grid.append(
				h("div", "db-cal-weekday", day.toLocaleDateString(undefined, { weekday: "short" })),
			);
		}
		const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
		const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
		const weeks = Math.ceil((month.getDay() + days) / 7);
		const todayKey = dayKey(today);
		for (let i = 0; i < weeks * 7; i++) {
			const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
			const key = dayKey(date);
			const cell = h(
				"div",
				`db-cal-day${date.getMonth() === month.getMonth() ? "" : " is-other"}${key === todayKey ? " is-today" : ""}`,
			);
			cell.dataset.date = key;
			const top = h("div", "db-cal-day-top");
			const add = h("button", "db-icon-btn db-cal-add");
			add.type = "button";
			add.title = "New row on this day";
			add.setAttribute("aria-label", `New row on ${key}`);
			add.innerHTML = icon("plus", 14);
			add.addEventListener("click", () => void this.#addRow({ [dateCol.id]: key }));
			top.append(h("span", "db-cal-num", String(date.getDate())), add);
			cell.append(top);
			for (const row of byDay.get(key) ?? []) cell.append(this.#calChip(row));
			this.#calDrop(cell, dateCol.id, key);
			grid.append(cell);
		}
		wrap.append(grid);

		if (undated.length > 0) {
			const tray = h("div", "db-cal-undated");
			tray.append(h("div", "db-cal-undated-head", `No ${dateCol.name} · ${undated.length}`));
			const list = h("div", "db-cal-undated-list");
			for (const row of undated) list.append(this.#calChip(row));
			tray.append(list);
			wrap.append(tray);
		}
		return wrap;
	}

	#calChip(row: Row): HTMLElement {
		const chip = this.#item(row, "db-cal-chip");
		chip.draggable = true;
		if (row.icon) chip.append(h("span", "db-item-icon", row.icon));
		const title = h("span", "db-card-title", row.title.trim() || "Untitled");
		if (!row.title.trim()) title.classList.add("is-empty");
		chip.append(title);
		chip.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/x-cf-row", row.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			this.#dragRow = row.id;
			chip.classList.add("is-dragging");
		});
		chip.addEventListener("dragend", () => {
			this.#dragRow = null;
			chip.classList.remove("is-dragging");
		});
		return chip;
	}

	/** Dropping a row on a day gives it that date (shown at once, then saved). */
	#calDrop(cell: HTMLElement, columnId: string, key: string) {
		const accepts = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("text/x-cf-row"));
		cell.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			cell.classList.add("is-drop");
		});
		cell.addEventListener("dragleave", (e) => {
			if (!cell.contains(e.relatedTarget as Node)) cell.classList.remove("is-drop");
		});
		cell.addEventListener("drop", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			cell.classList.remove("is-drop");
			const rowId = this.#dragRow ?? e.dataTransfer!.getData("text/x-cf-row");
			const state = this.#state;
			const row = state?.rows.find((r) => r.id === rowId);
			if (!state || !row || row.cells[columnId] === key) return;
			this.#state = {
				...state,
				rows: state.rows.map((r) =>
					r === row ? { ...row, cells: { ...row.cells, [columnId]: key } } : r,
				),
			};
			this.#render();
			void this.op({ op: "setCell", rowId, columnId, value: key });
		});
	}

	// ---------- board ----------

	#board(state: DatabaseState): HTMLElement {
		const view = this.#view;
		const group = state.columns.find((c) => c.id === view.groupBy && canGroup(c));
		if (!group) return this.#boardSetup(state);

		const rows = applyView(state.columns, state.rows, view, this.#keep, state.titles);
		const board = h("div", "db-board");
		const groups: { id: string | null; option?: SelectOption }[] = [
			{ id: null },
			...(group.options ?? []).map((option) => ({ id: option.id, option })),
		];
		const valueOf = (row: Row) =>
			(readCell(group, row.cells[group.id]) as SelectOption | null)?.id ?? null;
		const shownCols = state.columns.filter((c) => c.type !== "title" && c.id !== group.id);

		for (const { id, option } of groups) {
			const cards = rows.filter((row) => valueOf(row) === id);
			// "No <group>" only shows when something is in it (or there are no groups yet).
			if (id === null && cards.length === 0 && (group.options ?? []).length > 0) continue;
			const lane = h("div", "db-group");
			lane.dataset.option = id ?? "";
			const head = h("div", "db-group-head");
			if (option) head.append(pill(option));
			else head.append(h("span", "db-group-none", `No ${group.name}`));
			head.append(h("span", "db-group-count", String(cards.length)));
			const list = h("div", "db-group-cards");
			for (const row of cards) list.append(this.#card(row, shownCols));
			const add = withIcon(h("button", "db-group-add"), "plus", "New");
			add.type = "button";
			add.addEventListener("click", () => void this.#addRow({ [group.id]: id ?? undefined }));
			lane.append(head, list, add);
			this.#dropZone(lane, group.id, id);
			board.append(lane);
		}

		const addGroup = withIcon(h("button", "db-group-new"), "plus", "Add group");
		addGroup.type = "button";
		addGroup.addEventListener("click", () => {
			let name = "";
			this.#pop.open(addGroup, (panel, refocus) => {
				const input = h("input", "db-pop-input");
				input.placeholder = "Group name";
				input.setAttribute("aria-label", "Group name");
				input.addEventListener("input", () => (name = input.value));
				input.addEventListener("keydown", (e) => {
					if (e.key !== "Enter" || !name.trim()) return;
					e.preventDefault();
					this.#pop.close();
					void this.op({ op: "addOption", columnId: group.id, name });
				});
				panel.append(input);
				refocus(input);
			});
		});
		board.append(addGroup);
		return board;
	}

	/** A board with nothing to group by yet: pick a select, or make a Status one. */
	#boardSetup(state: DatabaseState): HTMLElement {
		const box = h("div", "db-board-setup");
		const selects = state.columns.filter((c) => canGroup(c));
		box.append(h("p", "", "A board groups cards by a Select or Status property."));
		for (const column of selects) {
			const pick = withIcon(
				h("button", "db-chip"),
				TYPE_ICONS[column.type],
				`Group by ${column.name}`,
			);
			pick.type = "button";
			pick.addEventListener("click", () => this.#setView({ ...this.#view, groupBy: column.id }));
			box.append(pick);
		}
		const make = withIcon(h("button", "db-chip db-board-status"), "plus", "Add a Status property");
		make.type = "button";
		make.addEventListener("click", async () => {
			const reply = await this.op({ op: "addColumn", type: "status", name: "Status" });
			if (typeof reply?.columnId === "string") {
				this.#setView({ ...this.#view, groupBy: reply.columnId });
			}
		});
		box.append(make);
		return box;
	}

	/** A board card: the row's name and its non-empty properties. Click opens the row. */
	#card(row: Row, columns: Column[]): HTMLElement {
		const card = h("div", "db-card");
		card.dataset.row = row.id;
		card.draggable = true;
		card.tabIndex = 0;
		card.append(h("div", "db-card-title", row.title.trim() || "Untitled"));
		if (!row.title.trim()) card.querySelector(".db-card-title")!.classList.add("is-empty");
		for (const column of columns) {
			// An unticked checkbox isn't worth a line on a card.
			if (column.type === "checkbox" && readCell(column, row.cells[column.id]) !== true) continue;
			const prop = h("div", `db-card-prop db-type-${column.type}`);
			this.#fill(prop, column, row);
			if (prop.childElementCount > 0) card.append(prop);
		}
		const open = (e: Event) => {
			if ((e.target as Element).closest("a[href], input")) return;
			location.assign(`/p/${row.id}`);
		};
		card.addEventListener("click", open);
		card.addEventListener("keydown", (e) => {
			if (e.key === "Enter") open(e);
		});
		card.addEventListener("keydown", (e) => {
			// Alt+↑/↓ moves the card within its group (when the order isn't set by sorts).
			if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
			e.preventDefault();
			const lane = card.closest<HTMLElement>(".db-group");
			const group = this.#view.groupBy;
			if (!lane || !group || this.#view.sorts.length > 0) return;
			const list = lane.querySelector<HTMLElement>(".db-group-cards")!;
			const target =
				e.key === "ArrowUp"
					? card.previousElementSibling
					: (card.nextElementSibling?.nextElementSibling ?? null);
			if (e.key === "ArrowUp" && !target) return;
			if (e.key === "ArrowDown" && !card.nextElementSibling) return;
			const optionId = lane.dataset.option || null;
			this.#moveCard(
				row.id,
				group,
				optionId,
				this.#beforeId(list, row.id, target as HTMLElement | null),
			);
		});
		card.addEventListener("dragstart", (e) => {
			e.dataTransfer?.setData("text/x-cf-row", row.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
			this.#dragRow = row.id;
			card.classList.add("is-dragging");
		});
		card.addEventListener("dragend", () => {
			this.#dragRow = null;
			this.#dropLine.remove();
			card.classList.remove("is-dragging");
		});
		return card;
	}

	/**
	 * Dropping a card on a group: it joins the group, at the spot under the
	 * pointer (marked by a line). With sorts on, the order follows the sorts,
	 * so only the group changes.
	 */
	#dropZone(lane: HTMLElement, columnId: string, optionId: string | null) {
		const list = lane.querySelector<HTMLElement>(".db-group-cards")!;
		const accepts = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes("text/x-cf-row"));
		const sorted = () => this.#view.sorts.length > 0;
		/** The card the dragged one would land before (`null` = at the end). */
		const slot = (y: number): HTMLElement | null => {
			for (const card of list.querySelectorAll<HTMLElement>(".db-card:not(.is-dragging)")) {
				const box = card.getBoundingClientRect();
				if (y < box.top + box.height / 2) return card;
			}
			return null;
		};
		lane.addEventListener("dragover", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			lane.classList.add("is-drop");
			if (sorted()) return;
			const line = this.#dropLine;
			const before = slot(e.clientY);
			if (before) {
				if (line.nextElementSibling !== before) list.insertBefore(line, before);
			} else if (list.lastElementChild !== line) {
				list.append(line);
			}
		});
		lane.addEventListener("dragleave", (e) => {
			if (lane.contains(e.relatedTarget as Node)) return;
			lane.classList.remove("is-drop");
			this.#dropLine.remove();
		});
		lane.addEventListener("drop", (e) => {
			if (!accepts(e)) return;
			e.preventDefault();
			lane.classList.remove("is-drop");
			this.#dropLine.remove();
			const rowId = this.#dragRow ?? e.dataTransfer!.getData("text/x-cf-row");
			const before = sorted() ? undefined : slot(e.clientY);
			this.#moveCard(
				rowId,
				columnId,
				optionId,
				before === undefined ? undefined : this.#beforeId(list, rowId, before),
			);
		});
	}

	/** The line showing where a dragged card will land. */
	#dropLine = h("div", "db-drop-line");
	/** The card being dragged (drag events can't read their data until the drop). */
	#dragRow: string | null = null;

	/**
	 * The row a card should go before in the stored order to land just before
	 * `card` in its group (`null` = last). At the end of a group that means
	 * before whatever row follows the group's last card.
	 */
	#beforeId(list: HTMLElement, rowId: string, card: HTMLElement | null): string | null | undefined {
		if (card) return card.dataset.row!;
		const cards = [...list.querySelectorAll<HTMLElement>(".db-card")].filter(
			(c) => c.dataset.row !== rowId,
		);
		const last = cards.at(-1)?.dataset.row;
		if (!last) return undefined; // empty group: keep its place
		const rows = (this.#state?.rows ?? []).filter((r) => r.id !== rowId);
		return rows[rows.findIndex((r) => r.id === last) + 1]?.id ?? null;
	}

	/**
	 * Moves a card: into the group `optionId` of `columnId`, and (when `beforeId`
	 * isn't undefined) to just before that row in the stored order. Shown at once,
	 * then saved.
	 */
	#moveCard(
		rowId: string,
		columnId: string,
		optionId: string | null,
		beforeId: string | null | undefined,
	) {
		const state = this.#state;
		const row = state?.rows.find((r) => r.id === rowId);
		const column = state?.columns.find((c) => c.id === columnId);
		if (!state || !row || !column) return;
		const current = (readCell(column, row.cells[columnId]) as SelectOption | null)?.id ?? null;
		const regroup = current !== optionId;

		let rows = state.rows;
		if (beforeId !== undefined) {
			const rest = rows.filter((r) => r.id !== rowId);
			const at = beforeId === null ? rest.length : rest.findIndex((r) => r.id === beforeId);
			if (at < 0) return;
			rows = rest.toSpliced(at, 0, row);
		}
		// Only the order within the group shows, so that's what has to change.
		const inGroup = (list: Row[]) =>
			list
				.filter(
					(r) =>
						r === row ||
						((readCell(column, r.cells[columnId]) as SelectOption | null)?.id ?? null) === optionId,
				)
				.map((r) => r.id)
				.join();
		const reorder = beforeId !== undefined && (regroup || inGroup(rows) !== inGroup(state.rows));
		if (!regroup && !reorder) return;

		// Show it now; the reply redraws with what was stored.
		const cells = { ...row.cells };
		if (optionId) cells[columnId] = optionId;
		else delete cells[columnId];
		this.#state = { ...state, rows: rows.map((r) => (r === row ? { ...row, cells } : r)) };
		this.#render();
		void this.op({
			op: "moveRow",
			rowId,
			...(regroup ? { columnId, value: optionId } : {}),
			...(reorder ? { beforeId } : {}),
		}).then(() =>
			this.querySelector<HTMLElement>(`.db-card[data-row="${CSS.escape(rowId)}"]`)?.focus(),
		);
	}

	/** Names a new card in place. */
	#nameCard(card: HTMLElement, rowId: string) {
		const title = card.querySelector<HTMLElement>(".db-card-title");
		if (!title) return;
		const input = h("input", "db-input db-card-input");
		input.placeholder = "Type a name…";
		input.setAttribute("aria-label", "Name");
		title.replaceChildren(input);
		this.#editing = true;
		input.focus();
		let done = false;
		const finish = (save: boolean) => {
			if (done) return;
			done = true;
			this.#editing = false;
			if (save && input.value.trim()) void this.op({ op: "setTitle", rowId, title: input.value });
			else this.#render();
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") finish(true);
			else if (e.key === "Escape") finish(false);
		});
		input.addEventListener("blur", () => finish(true));
	}

	// ---------- menus ----------

	#selectMenu(rowId: string, columnId: string, cell: HTMLElement) {
		let query = "";
		let active = 0;
		const current = () => {
			const found = this.#find(rowId, columnId);
			if (!found) return null;
			const value = readCell(found.column, found.row.cells[columnId]);
			const selected =
				found.column.type !== "multi_select"
					? value
						? [value as SelectOption]
						: []
					: (value as SelectOption[]);
			return { ...found, selected };
		};
		const set = (ids: (string | { name: string })[]) => {
			const now = current();
			if (!now) return;
			const multi = now.column.type === "multi_select";
			void this.op({ op: "setCell", rowId, columnId, value: multi ? ids : (ids[0] ?? null) }).then(
				() => {
					if (multi) this.#pop.refresh();
				},
			);
			if (!multi) this.#pop.close();
		};

		this.#pop.open(cell, (panel, refocus) => {
			const now = current();
			if (!now) return;
			const { column, selected } = now;
			const multi = column.type === "multi_select";
			const ids = selected.map((o) => o.id);

			const chips = h("div", "db-pop-chips");
			for (const option of selected) {
				const chip = pill(option);
				const remove = h("button", "db-pill-x");
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${option.name}`);
				remove.innerHTML = icon("x", 12);
				remove.addEventListener("click", () => set(ids.filter((id) => id !== option.id)));
				chip.append(remove);
				chips.append(chip);
			}
			const input = h("input", "db-pop-input");
			input.placeholder = selected.length ? "" : "Search or create an option";
			input.value = query;
			input.setAttribute("aria-label", "Search options");
			chips.append(input);

			const q = query.trim().toLowerCase();
			const status = column.type === "status";
			// A status lists its options by group: To-do, In progress, Complete.
			const ordered = status
				? STATUS_GROUPS.flatMap((g) => (column.options ?? []).filter((o) => o.group === g.id))
				: (column.options ?? []);
			const options = ordered.filter((o) => o.name.toLowerCase().includes(q));
			const exact = (column.options ?? []).some((o) => o.name.toLowerCase() === q);
			type Choice = { option?: SelectOption; create?: string };
			const choices: Choice[] = options.map((option) => ({ option }));
			if (q && !exact) choices.push({ create: query.trim() });
			active = Math.min(active, Math.max(0, choices.length - 1));

			const list = h("div", "db-pop-list");
			list.append(
				h(
					"div",
					"db-pop-label",
					choices.length ? "Select an option or create one" : "No options yet",
				),
			);
			const choose = (choice: Choice) => {
				query = "";
				if (choice.create)
					set(multi ? [...ids, { name: choice.create }] : [{ name: choice.create }]);
				else if (choice.option) {
					const id = choice.option.id;
					set(multi ? (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]) : [id]);
				}
			};
			let lastGroup: string | undefined;
			choices.forEach((choice, index) => {
				const group = status ? (choice.option?.group ?? "todo") : undefined;
				if (group && group !== lastGroup) {
					lastGroup = group;
					list.append(h("div", "db-pop-label", STATUS_GROUPS.find((g) => g.id === group)!.name));
				}
				const item = h("button", `db-pop-item${index === active ? " is-active" : ""}`);
				item.type = "button";
				if (choice.create) item.append(h("span", "db-pop-create", "Create"));
				item.append(pill(choice.option ?? { id: "", name: choice.create!, color: "gray" }));
				if (choice.option && ids.includes(choice.option.id))
					item.insertAdjacentHTML("beforeend", icon("check", 14));
				item.addEventListener("click", () => choose(choice));
				item.addEventListener("pointermove", () => {
					if (active === index) return;
					active = index;
					list
						.querySelectorAll(".db-pop-item")
						.forEach((el, i) => el.classList.toggle("is-active", i === index));
				});
				list.append(item);
			});

			input.addEventListener("input", () => {
				query = input.value;
				active = 0;
				this.#pop.refresh();
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					if (!choices.length) return;
					active = (active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
					this.#pop.refresh();
				} else if (e.key === "Enter") {
					e.preventDefault();
					const choice = choices[active];
					if (choice) choose(choice);
				} else if (e.key === "Backspace" && !input.value && ids.length) {
					set(ids.slice(0, -1));
				}
			});
			panel.append(chips, list);
			refocus(input);
		});
	}

	#columnMenu(columnId: string, anchor: HTMLElement, selectName = false) {
		let renamed: string | null = null;
		const commitName = () => {
			const column = this.#state?.columns.find((c) => c.id === columnId);
			if (column && renamed !== null && renamed.trim() && renamed.trim() !== column.name) {
				void this.op({ op: "renameColumn", columnId, name: renamed });
			}
			renamed = null;
		};
		this.#pop.open(
			anchor,
			(panel, refocus) => {
				const state = this.#state;
				const column = state?.columns.find((c) => c.id === columnId);
				if (!state || !column) return this.#pop.close();
				const index = state.columns.indexOf(column);

				const name = h("input", "db-pop-input db-pop-name");
				name.value = renamed ?? column.name;
				name.maxLength = 100;
				name.setAttribute("aria-label", "Property name");
				name.addEventListener("input", () => (renamed = name.value));
				name.addEventListener("keydown", (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commitName();
						this.#pop.close();
					}
				});
				panel.append(name);

				const entries: MenuEntry[] = [];
				if (column.type === "relation") {
					// Relations aren't converted to other types (they own links).
					entries.push({ heading: this.#relationLabel(column) }, { separator: true });
				} else if (column.type === "rollup") {
					panel.append(this.#rollupSettings(column));
					entries.push({ separator: true });
				} else if (column.type === "script") {
					entries.push(
						{
							label: "Edit script…",
							icon: "code",
							run: () => {
								commitName();
								this.#pop.close();
								void this.#editScript(columnId);
							},
						},
						{ separator: true },
					);
				} else if (column.type !== "title") {
					entries.push({ heading: "Type" });
					for (const type of COLUMN_TYPES) {
						// Relations, rollups and scripts are made from scratch, not converted to.
						if (type === "relation" || type === "rollup" || type === "script") continue;
						entries.push({
							label: TYPE_LABELS[type],
							icon: TYPE_ICONS[type],
							checked: column.type === type,
							run: () => {
								if (type !== column.type) void this.op({ op: "setColumnType", columnId, type });
							},
						});
					}
					entries.push({ separator: true });
				}
				const before = state.columns[index - 1];
				const after = state.columns[index + 2];
				entries.push(
					{
						label: "Move left",
						icon: "arrowLeft",
						disabled: !before,
						run: () => void this.op({ op: "moveColumn", columnId, beforeId: before?.id }),
					},
					{
						label: "Move right",
						icon: "arrowRight",
						disabled: index === state.columns.length - 1,
						run: () => void this.op({ op: "moveColumn", columnId, beforeId: after?.id ?? null }),
					},
				);
				if (column.type !== "title") {
					entries.push({
						label: "Delete property",
						icon: "trash",
						danger: true,
						run: async () => {
							const yes = await confirmDialog({
								title: `Delete the “${column.name}” property?`,
								message: "Its values in every row are deleted too.",
							});
							if (yes) {
								void this.op({ op: "deleteColumn", columnId });
							}
						},
					});
				}
				panel.append(this.#pop.menu(entries, commitName));
				refocus(name, selectName);
			},
			commitName,
		);
	}

	#addColumnMenu(anchor: HTMLElement) {
		this.#pop.open(anchor, (panel) => {
			panel.append(
				this.#pop.menu([
					{ heading: "Property type" },
					...COLUMN_TYPES.map((type) => ({
						label: TYPE_LABELS[type],
						icon: TYPE_ICONS[type],
						// A rollup looks through a relation, so it needs one first.
						disabled: type === "rollup" && !this.#state?.columns.some((c) => c.type === "relation"),
						run: async () => {
							if (type === "relation") return this.#relationSetup(anchor);
							const reply = await this.op({ op: "addColumn", type });
							const id = typeof reply?.columnId === "string" ? reply.columnId : null;
							// A new script opens straight in its editor.
							if (id && type === "script") return void this.#editScript(id);
							const header = id
								? this.querySelector<HTMLElement>(
										`.db-th[data-col="${CSS.escape(id)}"] .db-th-btn, .db-prop-name[data-col="${CSS.escape(id)}"]`,
									)
								: null;
							if (id && header) this.#columnMenu(id, header, true);
						},
					})),
				]),
			);
		});
	}

	// ---------- scripts ----------

	/** Opens the script editor for a Script property; saving recomputes the database. */
	async #editScript(columnId: string) {
		const state = this.#state;
		const column = state?.columns.find((c) => c.id === columnId && c.type === "script");
		if (!state || !column) return;
		const { openScriptEditor } = await import("./script-editor.ts");
		await openScriptEditor({
			state,
			column,
			loadState: async (id) =>
				((await this.#ask({ op: "get", databaseId: id }))?.state as DatabaseState | undefined) ??
				null,
			save: async (script) => {
				const reply = await this.op({ op: "setScript", columnId, script });
				if (!reply) throw new Error("setScript failed");
			},
		});
	}

	// ---------- rollups ----------

	/** How a rollup's value reads in a cell. */
	#rollupText(column: Column, value: unknown): string {
		if (value === null || value === undefined) return "";
		const kind = rollupKind(column);
		if (kind === "percent" && typeof value === "number") return `${value}%`;
		if (kind === "date" && typeof value === "string") return formatDate(value);
		if (Array.isArray(value)) {
			return value.map((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(v) : v)).join(", ");
		}
		return typeof value === "number" || typeof value === "string" ? String(value) : "";
	}

	/** Related databases' columns, for the rollup settings (loaded once per menu). */
	#related = new Map<string, DatabaseState | null>();
	#loadRelated(id: string): DatabaseState | null | undefined {
		if (id === this.#id) return this.#state;
		if (!this.#related.has(id)) {
			this.#related.set(id, null);
			void this.#ask({ op: "get", databaseId: id }).then((reply) => {
				this.#related.set(id, (reply?.state as DatabaseState | undefined) ?? null);
				this.#pop.refresh();
			});
			return undefined;
		}
		return this.#related.get(id);
	}

	/** Relation, property and calculation pickers for a rollup column. */
	#rollupSettings(column: Column): HTMLElement {
		const config = column.rollup!;
		const box = h("div", "db-rollup-settings");
		const state = this.#state!;
		const relations = state.columns.filter((c) => c.type === "relation");
		const relation = relations.find((c) => c.id === config.relationId);
		const target = relation?.relation ? this.#loadRelated(relation.relation.databaseId) : null;
		const targetColumns = target?.columns.filter((c) => c.type !== "rollup") ?? [];
		const targetColumn = targetColumns.find((c) => c.id === config.targetId);
		const save = (change: Partial<typeof config>) =>
			void this.op({ op: "setRollup", columnId: column.id, rollup: { ...config, ...change } });

		const field = (label: string, control: HTMLElement) => {
			const row = h("label", "db-rollup-field");
			row.append(h("span", "db-rollup-label", label), control);
			box.append(row);
		};
		const select = (
			name: string,
			options: [string, string][],
			value: string,
			onChange: (v: string) => void,
		) => {
			const el = h("select", "db-select");
			el.setAttribute("aria-label", name);
			for (const [v, label] of options) el.append(new Option(label, v, false, v === value));
			if (!options.some(([v]) => v === value)) el.prepend(new Option("—", value, true, true));
			el.addEventListener("change", () => onChange(el.value));
			return el;
		};

		field(
			"Relation",
			select(
				"Relation",
				relations.map((c) => [c.id, c.name]),
				config.relationId,
				(relationId) => save({ relationId, targetId: "title", fn: "show_original" }),
			),
		);
		field(
			"Property",
			target === undefined
				? h("span", "db-rollup-label", "Loading…")
				: select(
						"Property",
						targetColumns.map((c) => [c.id, c.name]),
						config.targetId,
						(targetId) => save({ targetId, fn: "show_original" }),
					),
		);
		field(
			"Calculate",
			select(
				"Calculate",
				fnsFor(targetColumn?.type ?? "title").map((fn) => [fn, ROLLUP_FNS[fn].label]),
				config.fn,
				(fn) => save({ fn: fn as typeof config.fn }),
			),
		);
		return box;
	}

	// ---------- relations ----------

	/** A request about another database (its rows, a new row there) that doesn't change this view. */
	async #ask(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
		try {
			const res = await fetch(location.pathname + this.#path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
		} catch (error) {
			console.warn(error);
			return null;
		}
	}

	#databaseList: DatabaseInfo[] | null = null;
	#listedAt = 0;
	async #databases(): Promise<DatabaseInfo[]> {
		this.#listedAt = Date.now();
		const reply = await this.#ask({ op: "databases" });
		this.#databaseList = (reply?.databases as DatabaseInfo[] | undefined) ?? [];
		return this.#databaseList;
	}

	#relationLabel(column: Column): string {
		const relation = column.relation;
		if (!relation) return "Relation";
		const way = relation.twinId || relation.sourceColumnId ? "two-way" : "one-way";
		if (relation.databaseId === this.#id) return `Relation to this database (${way})`;
		const target = this.#databaseList?.find((d) => d.id === relation.databaseId);
		// Not listed yet (or new): ask again, but not in a loop if it's really gone.
		if (!target && Date.now() - this.#listedAt > 5000)
			void this.#databases().then(() => this.#pop.refresh());
		const name = target ? target.title.trim() || "Untitled" : "another database";
		return `Relation to ${name} (${way})`;
	}

	#relatedChip(id: string): HTMLElement {
		const title = this.#state?.titles[id];
		const chip = withIcon(h("a", "db-rel"), "fileText", (title ?? "").trim() || "Untitled", 13);
		chip.href = `/p/${id}`;
		return chip;
	}

	/** Pick the database a new relation points to, and whether it shows there too. */
	#relationSetup(anchor: HTMLElement) {
		let twoWay = false;
		let list: { id: string; title: string }[] | null = null;
		void this.#databases().then((all) => {
			list = all;
			this.#pop.refresh();
		});
		this.#pop.open(anchor, (panel) => {
			panel.append(h("div", "db-pop-label", "Relation to"));
			if (!list) {
				panel.append(h("div", "db-pop-label", "Loading…"));
				return;
			}
			const toggle = h("label", "db-pop-toggle");
			const box = h("input");
			box.type = "checkbox";
			box.checked = twoWay;
			box.addEventListener("change", () => (twoWay = box.checked));
			toggle.append(box, h("span", "", "Show on the related database too"));
			panel.append(
				toggle,
				this.#pop.menu(
					list.map((db) => ({
						label: `${db.title.trim() || "Untitled"}${db.id === this.#id ? " (this database)" : ""}`,
						icon: "table" as const,
						run: async () => {
							const reply = await this.op({
								op: "addColumn",
								type: "relation",
								relation: { databaseId: db.id, twoWay },
							});
							const id = typeof reply?.columnId === "string" ? reply.columnId : null;
							const header = id
								? this.querySelector<HTMLElement>(
										`.db-th[data-col="${CSS.escape(id)}"] .db-th-btn, .db-prop-name[data-col="${CSS.escape(id)}"]`,
									)
								: null;
							if (id && header) this.#columnMenu(id, header, true);
						},
					})),
				),
			);
		});
	}

	/** Link a row to rows of the related database: search, toggle, or create one. */
	/** Picks people for a Person cell, from everyone who may sign in. */
	#personMenu(rowId: string, columnId: string, cell: HTMLElement) {
		let query = "";
		let active = 0;
		const current = () => {
			const found = this.#find(rowId, columnId);
			return found ? (readCell(found.column, found.row.cells[columnId]) as string[]) : [];
		};
		const set = (emails: string[]) =>
			void this.op({ op: "setCell", rowId, columnId, value: emails }).then(() =>
				this.#pop.refresh(),
			);

		this.#pop.open(cell, (panel, refocus) => {
			const chosen = current();
			const chips = h("div", "db-pop-chips");
			for (const email of chosen) {
				const chip = personChip(email);
				const remove = h("button", "db-pill-x");
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${email}`);
				remove.innerHTML = icon("x", 12);
				remove.addEventListener("click", () => set(chosen.filter((e) => e !== email)));
				chip.append(remove);
				chips.append(chip);
			}
			const input = h("input", "db-pop-input");
			input.placeholder = chosen.length ? "" : "Search for a person";
			input.value = query;
			input.setAttribute("aria-label", "Search people");
			chips.append(input);

			const q = query.trim().toLowerCase();
			const people = (this.#state?.people ?? []).filter((e) => e.includes(q));
			active = Math.min(active, Math.max(0, people.length - 1));
			const list = h("div", "db-pop-list");
			list.append(
				h("div", "db-pop-label", people.length ? "Select people" : "No one by that address"),
			);
			const toggle = (email: string) =>
				set(chosen.includes(email) ? chosen.filter((e) => e !== email) : [...chosen, email]);
			people.forEach((email, index) => {
				const item = h("button", `db-pop-item${index === active ? " is-active" : ""}`);
				item.type = "button";
				item.append(personChip(email));
				if (chosen.includes(email)) item.insertAdjacentHTML("beforeend", icon("check", 14));
				item.addEventListener("click", () => toggle(email));
				list.append(item);
			});
			input.addEventListener("input", () => {
				query = input.value;
				active = 0;
				this.#pop.refresh();
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					if (!people.length) return;
					active = (active + (e.key === "ArrowDown" ? 1 : -1) + people.length) % people.length;
					this.#pop.refresh();
				} else if (e.key === "Enter") {
					e.preventDefault();
					const email = people[active];
					if (email) toggle(email);
				} else if (e.key === "Backspace" && !input.value && chosen.length) {
					set(chosen.slice(0, -1));
				}
			});
			panel.append(chips, list);
			refocus(input);
		});
	}

	/** A Files & media cell's files: open, remove, or upload more. */
	#filesMenu(rowId: string, columnId: string, cell: HTMLElement) {
		let uploading = 0;
		const current = () => {
			const found = this.#find(rowId, columnId);
			return found ? (readCell(found.column, found.row.cells[columnId]) as FileRef[]) : [];
		};
		const set = (files: FileRef[]) =>
			this.op({ op: "setCell", rowId, columnId, value: files }).then(() => this.#pop.refresh());
		const add = async (picked: File[]) => {
			uploading += picked.length;
			this.#pop.refresh();
			const made: FileRef[] = [];
			for (const file of picked) {
				const ref = await uploadFile(file);
				if (ref) made.push(ref);
				uploading--;
			}
			// Read the cell again: it may have changed while the files went up.
			if (made.length) await set([...current(), ...made]);
			else this.#pop.refresh();
		};

		this.#pop.open(cell, (panel) => {
			const files = current();
			const list = h("div", "db-pop-list db-files");
			if (!files.length && !uploading) list.append(h("div", "db-pop-label", "No files yet"));
			for (const file of files) {
				const item = h("div", "db-file-row");
				const remove = h("button", "db-pill-x");
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${file.name}`);
				remove.innerHTML = icon("x", 12);
				remove.addEventListener("click", () => void set(files.filter((f) => f.key !== file.key)));
				item.append(fileChip(file), remove);
				list.append(item);
			}
			if (uploading) list.append(h("div", "db-pop-label", `Uploading ${uploading}…`));
			const picker = h("input");
			picker.type = "file";
			picker.multiple = true;
			picker.hidden = true;
			picker.addEventListener("change", () => {
				const picked = [...(picker.files ?? [])];
				if (picked.length) void add(picked);
			});
			const upload = withIcon(h("button", "db-pop-item db-files-add"), "plus", "Upload a file");
			upload.type = "button";
			upload.addEventListener("click", () => picker.click());
			panel.append(list, upload, picker);
			upload.focus();
		});
	}

	#relationMenu(rowId: string, columnId: string, cell: HTMLElement) {
		const column = this.#state?.columns.find((c) => c.id === columnId);
		const targetId = column?.relation?.databaseId;
		if (!column || !targetId) return;
		let query = "";
		let active = 0;
		let rows: { id: string; title: string }[] | null = null;
		const load = async () => {
			const reply =
				targetId === this.#id
					? { state: this.#state }
					: await this.#ask({ op: "get", databaseId: targetId });
			const state = reply?.state as DatabaseState | null | undefined;
			rows = state ? state.rows.map((r) => ({ id: r.id, title: r.title })) : [];
			this.#pop.refresh();
		};
		void load();

		const current = () => {
			const row = this.#state?.rows.find((r) => r.id === rowId);
			return row ? (readCell(column, row.cells[columnId]) as string[]) : [];
		};
		const set = (ids: string[]) =>
			void this.op({ op: "setCell", rowId, columnId, value: ids }).then(() => this.#pop.refresh());
		const titleOf = (id: string) =>
			(rows?.find((r) => r.id === id)?.title ?? this.#state?.titles[id] ?? "").trim() || "Untitled";

		this.#pop.open(cell, (panel, refocus) => {
			const ids = current();
			const chips = h("div", "db-pop-chips");
			for (const id of ids) {
				const chip = withIcon(h("span", "db-rel"), "fileText", titleOf(id), 13);
				const remove = h("button", "db-pill-x");
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${titleOf(id)}`);
				remove.innerHTML = icon("x", 12);
				remove.addEventListener("click", () => set(ids.filter((x) => x !== id)));
				chip.append(remove);
				chips.append(chip);
			}
			const input = h("input", "db-pop-input");
			input.placeholder = "Search for a page…";
			input.value = query;
			input.setAttribute("aria-label", "Search pages");
			chips.append(input);
			panel.append(chips);

			type Choice = { id?: string; create?: string };
			const q = query.trim().toLowerCase();
			const found = (rows ?? []).filter((r) =>
				(r.title.trim() || "Untitled").toLowerCase().includes(q),
			);
			const choices: Choice[] = found.slice(0, 50).map((r) => ({ id: r.id }));
			if (q && rows) choices.push({ create: query.trim() });
			active = Math.min(active, Math.max(0, choices.length - 1));

			const list = h("div", "db-pop-list");
			list.append(
				h(
					"div",
					"db-pop-label",
					rows ? (found.length ? "Link a page" : "No pages found") : "Loading…",
				),
			);
			const choose = async (choice: Choice) => {
				if (choice.id) {
					set(ids.includes(choice.id) ? ids.filter((x) => x !== choice.id) : [...ids, choice.id]);
				} else if (choice.create) {
					query = "";
					const made = await this.#ask({
						op: "addRow",
						databaseId: targetId,
						title: choice.create,
					});
					const id = typeof made?.rowId === "string" ? made.rowId : null;
					if (!id) return;
					await load();
					set([...current(), id]);
				}
			};
			choices.forEach((choice, index) => {
				const item = h("button", `db-pop-item${index === active ? " is-active" : ""}`);
				item.type = "button";
				if (choice.create) {
					withIcon(item, "filePlus", `New page “${choice.create}”`, 14);
				} else {
					withIcon(item, "fileText", titleOf(choice.id!), 14);
					if (ids.includes(choice.id!)) item.insertAdjacentHTML("beforeend", icon("check", 14));
				}
				item.addEventListener("click", () => void choose(choice));
				list.append(item);
			});
			input.addEventListener("input", () => {
				query = input.value;
				active = 0;
				this.#pop.refresh();
			});
			input.addEventListener("keydown", (e) => {
				if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					if (!choices.length) return;
					active = (active + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length;
					this.#pop.refresh();
				} else if (e.key === "Enter") {
					e.preventDefault();
					const choice = choices[active];
					if (choice) void choose(choice);
				} else if (e.key === "Backspace" && !input.value && ids.length) {
					set(ids.slice(0, -1));
				}
			});
			panel.append(list);
			refocus(input);
		});
	}

	#rowMenu(rowId: string, anchor: HTMLElement) {
		const row = this.#state?.rows.find((r) => r.id === rowId);
		if (!row) return;
		this.#pop.open(anchor, (panel) => {
			panel.append(
				this.#pop.menu([
					{ label: "Open", icon: "arrowUpRight", run: () => location.assign(`/p/${rowId}`) },
					{
						label: "Delete",
						icon: "trash",
						danger: true,
						run: async () => {
							// No question: it goes to Trash, and the toast offers Undo.
							if (!(await this.op({ op: "deleteRow", rowId }))) return;
							const databaseId = this.#id;
							archivedToast({
								id: rowId,
								title: row.title,
								// Every view of this database reloads to show the row again.
								onUndone: () =>
									document.dispatchEvent(
										new CustomEvent("cf-database-dirty", {
											detail: { source: "", ids: [databaseId] },
										}),
									),
							});
						},
					},
				]),
			);
		});
	}

	#databaseMenu(anchor: HTMLElement) {
		const state = this.#state;
		if (!state) return;
		this.#pop.open(anchor, (panel) => {
			panel.append(
				this.#pop.menu([
					{
						label: "Open as full page",
						icon: "arrowUpRight",
						run: () => location.assign(`/p/${state.id}`),
					},
					{
						label: "Delete database",
						icon: "trash",
						danger: true,
						run: async () => {
							if (!(await this.op({ op: "delete" }))) return;
							// The editor removes the block and offers Undo (see notes/adapters.ts).
							this.dispatchEvent(
								new CustomEvent("cf-database-deleted", {
									detail: { id: state.id, title: state.title },
									bubbles: true,
								}),
							);
						},
					},
				]),
			);
		});
	}
}

export const defineDatabaseView = () => {
	if (!customElements.get("cf-database")) customElements.define("cf-database", DatabaseView);
};
