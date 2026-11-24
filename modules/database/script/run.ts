/**
 * Works out a database's script columns and cell formulas inside QuickJS: a
 * separate JavaScript engine (WebAssembly) with no network, no page, no
 * storage, nothing but the data it's handed. Each attempt gets a fresh runtime
 * with a memory cap, and every cell its own deadline.
 *
 * Cells are worked out when first needed, so scripts and formulas can read
 * each other's results in any order (a loop is reported as one). A cell that
 * runs away (too long, too much memory) is marked as failed and the run starts
 * again without it, so one bad formula doesn't take the others down.
 *
 * The caller supplies the engine (`QuickJSWASMModule`): the server and the
 * browser load the same WebAssembly in their own ways.
 */
import type { QuickJSWASMModule } from "quickjs-emscripten-core";

import { isScriptError, type ScriptValue, type SheetInput } from "./script.ts";

export interface RunLimits {
	/** Wall-clock budget for each cell, in ms. */
	timeMs: number;
	/** Wall-clock budget for everything, in ms. */
	totalMs: number;
	memoryBytes: number;
}

export const DEFAULT_LIMITS: RunLimits = {
	timeMs: 1000,
	totalMs: 2000,
	memoryBytes: 32 * 1024 * 1024,
};

export interface SheetResult {
	/** Each worked-out cell, by `"row:col"` (positions in the input). An error is `{$error}`. */
	cells: Map<string, ScriptValue>;
	/** `console.log` output, for the editors' previews (capped). */
	logs: string[];
	/** Set when nothing could run at all (then every cell is that error). */
	error?: string;
}

const TOO_LONG = "The script took too long.";
const TOO_MUCH = "The script used too much memory.";
const MAX_ATTEMPTS = 6;

/**
 * Inside the sandbox: swaps relation ids for the related rows, freezes the
 * data (scripts can't change what other cells see), defines `__ref` for
 * `[row:column]` references and the helpers, then works out every program's
 * cells and turns each result into something storable.
 */
const PRELUDE = String.raw`
"use strict";
const __in = JSON.parse(__input);
const __logs = [];
const __show = (v) => typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
globalThis.console = { log: (...a) => { if (__logs.length < 50) __logs.push(a.map(__show).join(" ").slice(0, 500)); } };
console.info = console.warn = console.error = console.log;
const __cols = __in.columns;
const __R = __in.rows;
const __freeze = (v) => {
	if (v && typeof v === "object" && !Object.isFrozen(v)) {
		Object.freeze(v);
		for (const k of Object.keys(v)) __freeze(v[k]);
	}
	return v;
};
__cols.forEach((c, ci) => {
	if (!c.rel) return;
	const rel = __in.relations[c.name];
	const byId = new Map((rel ? rel.rows : []).map((r) => [r.$id, r]));
	for (const row of __R) {
		const ids = Array.isArray(row.v[ci]) ? row.v[ci] : [];
		row.v[ci] = ids.map((id) => byId.get(id)).filter(Boolean);
	}
});
__freeze(__in.relations);
__freeze(__R);
const __msg = (e) => String(e && e.message ? e.message : e).slice(0, 300);

// ---- programs ----
const __colProg = [];
const __cellProg = new Map();
const __make = (p) => {
	if (p.error) return { error: p.error };
	if (!p.js.trim()) return { empty: true };
	try {
		return { fn: (0, eval)("(function () {\n" + p.js + "\nreturn __script;\n})()") };
	} catch (e) {
		return { error: __msg(e) };
	}
};
for (const p of __in.programs) {
	const prog = __make(p);
	if (p.row < 0) __colProg[p.col] = prog;
	else __cellProg.set(p.row + ":" + p.col, prog);
}
const __progAt = (r, c) => __cellProg.get(r + ":" + c) || __colProg[c];

// ---- working cells out ----
const __memo = new Map();
const __busy = new Set();
globalThis.__stack = [];
// The row being worked out, from 0 in the database's own order: rows[rowIndex] is row.
Object.defineProperty(globalThis, "rowIndex", {
	get() {
		const top = __stack[__stack.length - 1];
		return top ? Number(top.split(":")[0]) : null;
	},
});
const __label = (r, c) => "row " + (r + 1) + " · " + __cols[c].name;
const __isErr = (v) => !!v && typeof v === "object" && typeof v.$error === "string";
function __compute(r, c, prog) {
	const key = r + ":" + c;
	if (__memo.has(key)) return __memo.get(key);
	const failed = __in.failed[key] || (r >= 0 && !__cellProg.has(key) && __in.failed["*:" + c]);
	if (failed) {
		const v = { $error: failed };
		__memo.set(key, v);
		return v;
	}
	if (__busy.has(key)) throw new Error("Circular reference: " + __label(r, c) + " depends on itself.");
	__busy.add(key);
	__stack.push(key);
	let v;
	try {
		v = prog.error ? { $error: prog.error } : prog.empty ? null : __norm(prog.fn(__rowObj(r), __rows, db));
		if (Array.isArray(v)) Object.freeze(v);
	} catch (e) {
		// Out of memory (or stopped by the deadline) ends the attempt, not just this cell.
		if (e instanceof InternalError) throw e;
		v = { $error: __msg(e) };
	} finally {
		__busy.delete(key);
		__stack.pop();
	}
	__memo.set(key, v);
	return v;
}
/** A cell's value: its own, or worked out. Reading a cell that failed fails too. */
function __get(r, c) {
	const prog = __progAt(r, c);
	const v = prog ? __compute(r, c, prog) : __R[r].v[c];
	if (__isErr(v)) {
		throw new Error(v.$error.startsWith("Error in ") || v.$error.startsWith("Circular") ? v.$error : "Error in " + __label(r, c) + ": " + v.$error);
	}
	return v === undefined ? null : v;
}

// ---- what scripts see ----
const __rowObjs = [];
function __rowObj(r) {
	if (__rowObjs[r]) return __rowObjs[r];
	const o = { $id: __R[r].id };
	__cols.forEach((c, ci) => Object.defineProperty(o, c.name, { enumerable: true, get: () => __get(r, ci) }));
	return (__rowObjs[r] = Object.freeze(o));
}
const __rows = Object.freeze(__R.map((_, r) => __rowObj(r)));
const db = Object.freeze({
	name: __in.name,
	rows: __rows,
	related(prop) {
		const rel = __in.relations[prop];
		if (!rel) throw new Error("No relation property named " + JSON.stringify(prop));
		return rel.rows;
	},
});

// ---- [row:column] ----
function __axis(spec, here, n, byName, what) {
	const at = (a) => {
		switch (a[0]) {
			case "@": return here;
			case "~": return here + a[1];
			case "#":
				if (a[1] < 1 || a[1] > n) throw new Error("There's no " + what + " " + a[1] + ".");
				return a[1] - 1;
			case "$": {
				const i = byName(a[1]);
				if (i < 0) throw new Error("There's no " + what + " named " + JSON.stringify(a[1]) + ".");
				return i;
			}
		}
		throw new Error("Bad reference.");
	};
	const span = (from, to) => {
		const out = [];
		for (let i = Math.max(0, from); i <= Math.min(n - 1, to); i++) out.push(i);
		return out;
	};
	if (spec[0] === "!") return { list: span(0, n - 1) };
	if (spec[0] === "..") return { list: span(at(spec[1]), at(spec[2])) };
	const i = at(spec);
	// Past the edge (like [-1:@] on the first row) reads as empty.
	return { one: i >= 0 && i < n ? i : null };
}
function __ref(rowSpec, colSpec) {
	const top = __stack[__stack.length - 1];
	if (!top) throw new Error("References work while a cell is being worked out.");
	const [r0, c0] = top.split(":").map(Number);
	const rows = __axis(rowSpec, r0, __R.length, (name) => __R.findIndex((x) => x.title === name), "row");
	const cols = __axis(colSpec, c0, __cols.length, (name) => {
		const i = __cols.findIndex((c) => c.name === name);
		return i >= 0 ? i : __cols.findIndex((c) => c.name.toLowerCase() === String(name).toLowerCase());
	}, "column");
	const val = (r, c) => (r === null || c === null ? null : __get(r, c));
	if (rows.list && cols.list) return Object.freeze(rows.list.map((r) => Object.freeze(cols.list.map((c) => __get(r, c)))));
	if (rows.list) return Object.freeze(rows.list.map((r) => val(r, cols.one)));
	if (cols.list) return Object.freeze(cols.list.map((c) => val(rows.one, c)));
	return val(rows.one, cols.one);
}

// ---- helpers ----
const __nums = (a) => a.flat(Infinity).filter((x) => typeof x === "number" && Number.isFinite(x));
globalThis.sum = (...a) => __nums(a).reduce((s, x) => s + x, 0);
globalThis.avg = (...a) => { const n = __nums(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null; };
globalThis.min = (...a) => { const n = __nums(a); return n.length ? Math.min(...n) : null; };
globalThis.max = (...a) => { const n = __nums(a); return n.length ? Math.max(...n) : null; };
globalThis.count = (...a) => a.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== "").length;
globalThis.round = (x, digits = 0) => { const f = 10 ** digits; return Math.round(x * f) / f; };

const __norm = (v) => {
	if (v === undefined || v === null) return null;
	if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 1e10) / 1e10 : String(v);
	if (typeof v === "string") return v.slice(0, 2000);
	if (typeof v === "boolean") return v;
	if (typeof v === "bigint") return String(v);
	if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
	if (Array.isArray(v))
		return v.slice(0, 100).map((x) => { const n = __norm(x); return n === null ? "" : typeof n === "string" ? n : JSON.stringify(n); });
	if (typeof v === "function") return null;
	const s = __show(v);
	return typeof s === "string" ? s.slice(0, 2000) : null;
};

// ---- run ----
const __out = [];
for (const p of __in.programs) {
	const targets = p.row < 0 ? __R.map((_, r) => r) : [p.row];
	for (const r of targets) {
		if (p.row < 0 && __cellProg.has(r + ":" + p.col)) continue;
		__tick();
		__out.push([r, p.col, __compute(r, p.col, __progAt(r, p.col))]);
	}
}
JSON.stringify({ out: __out, logs: __logs });
`;

type Attempt =
	| { ok: true; cells: Map<string, ScriptValue>; logs: string[] }
	| { ok: false; message: string; at: string | null };

/** Works out every program in `input`. Never throws. */
export function runSheet(
	engine: QuickJSWASMModule,
	input: SheetInput,
	limits: RunLimits = DEFAULT_LIMITS,
): SheetResult {
	const targets = (): string[] =>
		input.programs.flatMap((p) =>
			p.row < 0 ? input.rows.map((_, r) => `${r}:${p.col}`) : [`${p.row}:${p.col}`],
		);
	if (input.programs.length === 0 || input.rows.length === 0) return { cells: new Map(), logs: [] };
	const failed: Record<string, string> = { ...input.failed };
	const deadline = Date.now() + limits.totalMs;
	let last = "";
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		if (Date.now() >= deadline) break;
		const result = tryRun(engine, { ...input, failed }, limits, deadline);
		if (result.ok) return { cells: result.cells, logs: result.logs };
		last = result.message;
		if (!result.at) break;
		// A script column that runs away on one row would on all of them.
		const [row, col] = result.at.split(":");
		const isColumn =
			input.programs.some((p) => p.row < 0 && String(p.col) === col) &&
			!input.programs.some((p) => p.row >= 0 && `${p.row}:${p.col}` === result.at);
		failed[isColumn ? `*:${col}` : `${row}:${col}`] = result.message;
	}
	const error = last || TOO_LONG;
	return {
		cells: new Map(targets().map((key) => [key, { $error: error }])),
		logs: [],
		error,
	};
}

function tryRun(
	engine: QuickJSWASMModule,
	input: SheetInput,
	limits: RunLimits,
	deadline: number,
): Attempt {
	const runtime = engine.newRuntime();
	runtime.setMemoryLimit(limits.memoryBytes);
	runtime.setMaxStackSize(512 * 1024);
	let cellDeadline = Math.min(deadline, Date.now() + limits.timeMs);
	let timedOut = false;
	runtime.setInterruptHandler(() => {
		if (Date.now() > cellDeadline) timedOut = true;
		return timedOut;
	});
	const vm = runtime.newContext();
	/** The cell being worked out when the attempt stopped. */
	const where = (): string | null => {
		// Reading it runs a little code: no deadline or memory cap for that.
		cellDeadline = Infinity;
		timedOut = false;
		runtime.setMemoryLimit(-1);
		try {
			const stack = vm.getProp(vm.global, "__stack");
			const keys = vm.dump(stack) as unknown;
			stack.dispose();
			return Array.isArray(keys) && typeof keys.at(-1) === "string"
				? (keys.at(-1) as string)
				: null;
		} catch {
			return null;
		}
	};
	try {
		const data = vm.newString(JSON.stringify(input));
		vm.setProp(vm.global, "__input", data);
		data.dispose();
		const tick = vm.newFunction("__tick", () => {
			cellDeadline = Math.min(deadline, Date.now() + limits.timeMs);
		});
		vm.setProp(vm.global, "__tick", tick);
		tick.dispose();

		const result = vm.evalCode(PRELUDE, "run.js");
		if (result.error) {
			const message = timedOut ? TOO_LONG : describe(vm.dump(result.error));
			result.error.dispose();
			return { ok: false, message, at: where() };
		}
		const text = vm.getString(result.value);
		result.value.dispose();
		const { out, logs } = JSON.parse(text) as { out: [number, number, unknown][]; logs: string[] };
		return { ok: true, cells: new Map(out.map(([r, c, v]) => [`${r}:${c}`, clean(v)])), logs };
	} catch (error) {
		return { ok: false, message: timedOut ? TOO_LONG : describe(error), at: where() };
	} finally {
		vm.dispose();
		runtime.dispose();
	}
}

/** A value from the sandbox, checked again on this side. */
function clean(value: unknown): ScriptValue {
	if (value === null || typeof value === "number" || typeof value === "boolean") return value;
	if (typeof value === "string") return value.slice(0, 2000);
	if (Array.isArray(value)) return value.slice(0, 100).map((v) => String(v).slice(0, 500));
	if (isScriptError(value)) return { $error: value.$error.slice(0, 300) };
	return null;
}

function describe(error: unknown): string {
	if (error && typeof error === "object") {
		const { name, message } = error as { name?: unknown; message?: unknown };
		if (typeof message === "string") {
			if (/out of memory/i.test(message)) return TOO_MUCH;
			if (/interrupted/i.test(message)) return TOO_LONG;
			return `${typeof name === "string" && name !== "Error" ? `${name}: ` : ""}${message}`.slice(
				0,
				300,
			);
		}
	}
	return String(error).slice(0, 300);
}

/** One column's values from a result, row by row (for a script column's preview). */
export function columnValues(result: SheetResult, input: SheetInput, col: number): ScriptValue[] {
	return input.rows.map((_, r) => result.cells.get(`${r}:${col}`) ?? null);
}
