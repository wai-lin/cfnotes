/**
 * The editor for a Script property: TypeScript on the left with the properties
 * it can read, and a live preview on the right that runs the script on this
 * database's rows in the browser (the same sealed-off engine the server uses).
 */
import { TYPE_LABELS, type Column, type DatabaseState } from "@modules/database/columns";
import { icon } from "@modules/icons";
import {
	isScriptError,
	scriptText,
	type ScriptConfig,
	type ScriptValue,
} from "@modules/script/script";

export interface ScriptEditorOptions {
	state: DatabaseState;
	column: Column;
	/** Loads a linked database (for relations), or null if it can't. */
	loadState: (id: string) => Promise<DatabaseState | null>;
	/** Saves the script; resolves once the database has its new values. */
	save: (script: ScriptConfig) => Promise<void>;
}

const PREVIEW_ROWS = 20;

interface Preview {
	values: ScriptValue[];
	logs: string[];
	error?: string;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string) {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

/** How a property is read in a script. */
const access = (name: string) =>
	/^[A-Za-z_$][\w$]*$/.test(name) ? `row.${name}` : `row[${JSON.stringify(name)}]`;

/** Opens the editor. Resolves when it closes. */
export function openScriptEditor(options: ScriptEditorOptions): Promise<void> {
	const { state, column } = options;
	const original = column.script?.source ?? "";
	return new Promise((resolve) => {
		const dialog = h("dialog", "cf-dialog cf-script-dialog");
		dialog.setAttribute("aria-label", `Script for ${column.name}`);

		// ---- header ----
		const head = h("div", "script-head");
		const title = h("h2", "cf-dialog-title");
		title.innerHTML = icon("code", 16);
		title.append(h("span", "", column.name));
		head.append(
			title,
			h(
				"p",
				"script-intro",
				"TypeScript that works out this property for each row. Return the value to show.",
			),
		);

		// ---- code ----
		const code = h("textarea", "script-code");
		code.value = original;
		code.spellcheck = false;
		code.setAttribute("autocapitalize", "off");
		code.setAttribute("autocomplete", "off");
		code.setAttribute("aria-label", "Script");
		code.wrap = "off";

		const insert = (text: string) => {
			code.focus();
			const { selectionStart: a, selectionEnd: b, value } = code;
			code.value = value.slice(0, a) + text + value.slice(b);
			code.selectionStart = code.selectionEnd = a + text.length;
			schedule();
		};

		// ---- what it can read ----
		const refs = h("div", "script-refs");
		refs.append(h("div", "script-refs-title", "Properties — click to insert"));
		const chips = h("div", "script-chips");
		for (const c of state.columns) {
			if (c.id === column.id) continue;
			const chip = h("button", "script-chip");
			chip.type = "button";
			chip.append(h("code", "", access(c.name)), h("span", "", TYPE_LABELS[c.type]));
			chip.title =
				c.type === "relation"
					? "The related rows (each with its own properties)"
					: `${TYPE_LABELS[c.type]} property`;
			chip.addEventListener("click", () => insert(access(c.name)));
			chips.append(chip);
			if (c.type === "relation") {
				const all = h("button", "script-chip");
				all.type = "button";
				all.append(
					h("code", "", `db.related(${JSON.stringify(c.name)})`),
					h("span", "", "All linked rows"),
				);
				all.addEventListener("click", () => insert(`db.related(${JSON.stringify(c.name)})`));
				chips.append(all);
			}
		}
		for (const [text, label] of [
			["rows", "Every row"],
			["db.name", "Database name"],
		] as const) {
			const chip = h("button", "script-chip");
			chip.type = "button";
			chip.append(h("code", "", text), h("span", "", label));
			chip.addEventListener("click", () => insert(text));
			chips.append(chip);
		}
		refs.append(chips);

		const left = h("div", "script-left");
		left.append(code, refs);

		// ---- preview ----
		const status = h("div", "script-status", "Loading the script engine…");
		status.setAttribute("role", "status");
		const table = h("table", "script-preview");
		const logs = h("pre", "script-logs");
		logs.hidden = true;
		const right = h("div", "script-right");
		right.append(h("div", "script-refs-title", "Preview"), status, table, logs);

		const body = h("div", "script-body");
		body.append(left, right);

		// ---- actions ----
		const bar = h("div", "cf-dialog-actions");
		const help = h("span", "script-keys", "⌘↵ to save");
		const cancel = h("button", "cf-dialog-cancel", "Cancel");
		cancel.type = "button";
		const ok = h("button", "cf-dialog-ok", "Save");
		ok.type = "button";
		bar.append(help, cancel, ok);

		dialog.append(head, body, bar);
		document.body.append(dialog);
		dialog.showModal();
		code.focus();
		code.setSelectionRange(code.value.length, code.value.length);

		// ---- running the preview ----
		const tools = import("./script-engine");
		const linked = new Map<string, DatabaseState | null>();
		const linkedReady = Promise.all(
			state.columns.flatMap((c) => {
				const id = c.type === "relation" ? c.relation?.databaseId : undefined;
				if (!id || id === state.id || linked.has(id)) return [];
				linked.set(id, null);
				return [options.loadState(id).then((s) => void linked.set(id, s))];
			}),
		);
		let compiled: ScriptConfig = { source: original, js: "" };
		let runId = 0;
		const run = async () => {
			const id = ++runId;
			try {
				const { browserEngine, compileScript } = await tools;
				const [engine] = await Promise.all([browserEngine(), linkedReady]);
				if (id !== runId) return;
				compiled = compileScript(code.value);
				if (compiled.error) return show(null, compiled.error);
				const started = performance.now();
				const [{ runSheet, columnValues }, { sheetInput }] = await Promise.all([
					import("@modules/script/run"),
					import("@modules/script/script"),
				]);
				const input = sheetInput(state, linked, { columnId: column.id, config: compiled });
				const result = runSheet(engine, input);
				if (id !== runId) return;
				const values = columnValues(result, input, state.columns.indexOf(column));
				show({ values, logs: result.logs, error: result.error }, null, performance.now() - started);
			} catch (error) {
				console.error(error);
				if (id === runId) show(null, "The script engine couldn't load. Check your connection.");
			}
		};
		let timer = 0;
		const schedule = () => {
			clearTimeout(timer);
			timer = window.setTimeout(() => void run(), 250);
		};

		const titleColumn = state.columns.find((c) => c.type === "title");
		const show = (result: Preview | null, error: string | null, ms = 0) => {
			table.replaceChildren();
			logs.hidden = true;
			status.classList.toggle("is-error", Boolean(error ?? result?.error));
			if (error || !result) {
				status.textContent = error ?? "";
				return;
			}
			if (result.error) status.textContent = result.error;
			else {
				const failed = result.values.filter(isScriptError);
				status.textContent =
					`Ran on ${result.values.length} row${result.values.length === 1 ? "" : "s"} in ${Math.max(1, Math.round(ms))} ms` +
					(failed.length ? ` · ${failed.length} with errors` : "");
				// When every row fails the same way, say how.
				const reasons = new Set(failed.map((v) => v.$error));
				if (failed.length === result.values.length && reasons.size === 1)
					status.textContent += ` — ${[...reasons][0]}`;
			}
			const header = h("tr");
			header.append(h("th", "", titleColumn?.name ?? "Name"), h("th", "", column.name));
			table.append(header);
			state.rows.slice(0, PREVIEW_ROWS).forEach((row, i) => {
				const value = result.values[i];
				const tr = h("tr");
				const out = h("td");
				if (isScriptError(value)) {
					out.className = "is-error";
					out.textContent = `⚠ ${value.$error}`;
				} else {
					out.textContent = scriptText(value);
					if (value === null) out.append(h("span", "script-empty", "empty"));
				}
				tr.append(h("td", "", row.title.trim() || "Untitled"), out);
				table.append(tr);
			});
			if (state.rows.length > PREVIEW_ROWS) {
				const more = h("tr");
				const td = h("td", "script-empty", `…and ${state.rows.length - PREVIEW_ROWS} more`);
				td.colSpan = 2;
				more.append(td);
				table.append(more);
			}
			if (result.logs.length) {
				logs.hidden = false;
				logs.textContent = result.logs.join("\n");
			}
		};

		// ---- keys ----
		code.addEventListener("input", schedule);
		code.addEventListener("keydown", (event) => {
			if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				insert("  ");
			} else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void finish(true);
			}
		});

		let closing = false;
		const finish = async (save: boolean) => {
			if (closing) return;
			if (save) {
				closing = true;
				ok.disabled = cancel.disabled = true;
				ok.textContent = "Saving…";
				clearTimeout(timer);
				try {
					const { compileScript } = await tools;
					compiled = compileScript(code.value);
					await options.save(compiled);
				} catch (error) {
					console.error(error);
					closing = false;
					ok.disabled = cancel.disabled = false;
					ok.textContent = "Save";
					return;
				}
			}
			closing = true;
			runId++;
			dialog.close();
			dialog.remove();
			resolve();
		};
		ok.addEventListener("click", () => void finish(true));
		cancel.addEventListener("click", () => void finish(false));
		// Escape closes it only when nothing has changed (Cancel always does).
		dialog.addEventListener("cancel", (event) => {
			event.preventDefault();
			if (code.value === original) void finish(false);
		});

		void run();
	});
}
