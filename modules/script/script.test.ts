import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Column, DatabaseState } from "../database/columns";
import { compileFormula, compileScript } from "./compile";
import { translateRefs } from "./refs";
import { columnValues, runSheet, type RunLimits } from "./run";
import { isScriptError, resultKind, sheetInput, starterScript, type ScriptConfig } from "./script";

let engine: QuickJSWASMModule;
beforeAll(async () => {
	// The single-file build (WebAssembly inlined); the app uses `engine.ts` (same engine).
	engine = await newQuickJSWASMModuleFromVariant(variant);
});

const PROJECTS = "11111111-1111-4111-8111-111111111111";
const TASKS = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const P2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const T1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const T3 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";

const taskColumns: Column[] = [
	{ id: "title", name: "Task", type: "title" },
	{ id: "hrs", name: "Hours", type: "number" },
	{ id: "done", name: "Done", type: "checkbox" },
	{ id: "due", name: "Due", type: "date" },
];
const tasks: DatabaseState = {
	id: TASKS,
	title: "Tasks",
	hostId: null,
	views: [],
	titles: {},
	columns: taskColumns,
	rows: [
		{ id: T1, title: "Design", cells: { hrs: 5, done: true, due: "2026-11-01" } },
		{ id: T2, title: "Build", cells: { hrs: 12 } },
		{ id: T3, title: "Ship", cells: { hrs: 3, due: "2026-12-01" } },
	],
};
const projectColumns: Column[] = [
	{ id: "title", name: "Name", type: "title" },
	{ id: "rate", name: "Rate", type: "number" },
	{
		id: "st",
		name: "Status",
		type: "select",
		options: [{ id: "o1", name: "Active", color: "green" }],
	},
	{ id: "rel", name: "Tasks", type: "relation", relation: { databaseId: TASKS } },
];
const projects: DatabaseState = {
	id: PROJECTS,
	title: "Projects",
	hostId: null,
	views: [],
	titles: { [T1]: "Design", [T2]: "Build", [T3]: "Ship" },
	columns: projectColumns,
	rows: [
		{ id: P1, title: "Website", cells: { rate: 100, st: "o1", rel: [T1, T2] } },
		{ id: P2, title: "App", cells: { rate: 80, rel: [T3] } },
	],
};
const linked = new Map([[TASKS, tasks]]);

const LIMITS: RunLimits = { timeMs: 1000, totalMs: 3000, memoryBytes: 32 * 1024 * 1024 };

/** Runs `source` as a script column added to `state`; its values row by row. */
const run = (source: string, state = projects, limits = LIMITS) => {
	const script = compileScript(source);
	expect(script.error).toBeUndefined();
	const withScript: DatabaseState = {
		...state,
		columns: [...state.columns, { id: "s", name: "S", type: "script", script }],
	};
	const input = sheetInput(withScript, linked);
	const result = runSheet(engine, input, limits);
	return { ...result, values: columnValues(result, input, withScript.columns.length - 1) };
};

const formula = (source: string): ScriptConfig => {
	const compiled = compileFormula(source);
	expect(compiled.error).toBeUndefined();
	return compiled;
};

/** Projects with a number column "Cost" whose cells hold these formulas (by row). */
const withFormulas = (...sources: (string | null)[]): DatabaseState => ({
	...projects,
	columns: [...projectColumns, { id: "cost", name: "Cost", type: "number" }],
	rows: projects.rows.map((row, i) => {
		const source = sources[i];
		return source ? { ...row, formulas: { cost: formula(source) } } : row;
	}),
});

/** Every formula cell's value in the Cost column, row by row. */
const costs = (state: DatabaseState, limits = LIMITS) => {
	const input = sheetInput(state, linked);
	return columnValues(runSheet(engine, input, limits), input, 4);
};

describe("compileScript", () => {
	it("strips TypeScript and wraps the body so `return` works", () => {
		const out = compileScript("const x: number = row.Rate as number;\nreturn x * 2;");
		expect(out.error).toBeUndefined();
		expect(out.js).toContain("function __script(row, rows, db)");
		expect(out.js).not.toContain(": number");
	});

	it("reports syntax errors at the reader's line", () => {
		const out = compileScript("const a = 1;\nreturn a +;");
		expect(out.js).toBe("");
		expect(out.error).toMatch(/line 2/);
	});

	it("starts new properties on a number property when there is one", () => {
		expect(starterScript(projectColumns)).toContain('return row["Rate"] * 2;');
	});
});

describe("runScript", () => {
	it("gives each row its own values by property name", () => {
		const result = run('return `${row.Name}: ${row.Status ?? "—"} @ ${row.Rate}`;');
		expect(result.values).toEqual(["Website: Active @ 100", "App: — @ 80"]);
	});

	it("relation properties are the related rows themselves", () => {
		const result = run("return row.Tasks.reduce((sum, t) => sum + t.Hours, 0) * row.Rate;");
		expect(result.values).toEqual([1700, 240]);
	});

	it("sees every row, and every row of a linked database", () => {
		const share = run(
			"const total = rows.reduce((s, r) => s + r.Rate, 0);\nreturn Math.round((row.Rate / total) * 100);",
		);
		expect(share.values).toEqual([56, 44]);
		const open = run('return db.related("Tasks").filter((t) => !t.Done).length;');
		expect(open.values).toEqual([2, 2]);
	});

	it("dates come in as YYYY-MM-DD and Date results go out the same way", () => {
		const result = run(
			"const due = row.Tasks.map((t) => t.Due).filter(Boolean).sort();\nreturn due.length ? new Date(due[0] + 'T00:00:00Z') : null;",
		);
		expect(result.values).toEqual(["2026-11-01", "2026-12-01"]);
		expect(resultKind(result.values)).toBe("date");
	});

	it("an error in one row doesn't stop the others", () => {
		const result = run('if (row.Name === "App") throw new Error("no rate");\nreturn 1;');
		expect(result.values).toEqual([1, { $error: "no rate" }]);
		expect(result.error).toBeUndefined();
	});

	it("data is read-only", () => {
		const result = run("row.Rate = 0;\nreturn rows[0].Rate;");
		expect(result.values.every((v) => typeof v === "object" && v && "$error" in v)).toBe(true);
	});

	it("an endless loop is stopped", () => {
		const result = run("while (true) {}", projects, { ...LIMITS, timeMs: 100 });
		expect(result.values).toEqual([
			{ $error: "The script took too long." },
			{ $error: "The script took too long." },
		]);
	});

	it("runaway memory is stopped", () => {
		const result = run("const a = new Array(5e7).fill(1);\nreturn a.length;", projects, {
			...LIMITS,
			memoryBytes: 8 * 1024 * 1024,
		});
		expect(result.values[0]).toEqual({ $error: "The script used too much memory." });
	});

	it("has nothing to reach outside with", () => {
		const result = run(
			'return [typeof fetch, typeof XMLHttpRequest, typeof require, typeof process, typeof document].join(",");',
		);
		expect(result.values[0]).toBe("undefined,undefined,undefined,undefined,undefined");
	});

	it("collects console.log for the preview, and lists come back as text", () => {
		const result = run('console.log("rate", row.Rate);\nreturn row.Tasks.map((t) => t.Task);');
		expect(result.logs).toEqual(["rate 100", "rate 80"]);
		expect(result.values).toEqual([["Design", "Build"], ["Ship"]]);
	});
});

describe("cell references", () => {
	it("are rewritten outside strings and comments only", () => {
		expect(translateRefs('[1:Rate] + [-1:@] * [!:"Due date"]')).toBe(
			'__ref(["#",1], ["$","Rate"]) + __ref(["~",-1], ["@"]) * __ref(["!"], ["$","Due date"])',
		);
		expect(translateRefs('"[1:2]" // [1:2]\n`[1:2] ${[1:2]}`')).toBe(
			'"[1:2]" // [1:2]\n`[1:2] ${__ref(["#",1], ["#",2])}`',
		);
		expect(translateRefs("[1..-1:@]")).toBe('__ref(["..",["#",1],["~",-1]], ["@"])');
		expect(translateRefs("[a, b] = [x ? 1 : 2]")).toBe("[a, b] = [x ? 1 : 2]");
	});

	it("a formula is an expression, or a body with its own return", () => {
		expect(compileFormula("[@:Rate] * 2").js).toContain("return (");
		expect(compileFormula("const r = [@:Rate];\nreturn r * 2;").js).not.toContain("return (const");
		expect(compileFormula("[@:Rate] *").error).toMatch(/line 1/);
	});

	it("read cells by position, name, title, relative place and range", () => {
		expect(
			costs(withFormulas("[@:Rate] * 2 + [1:2]", 'sum([!:Rate]) + ["Website":Rate] + [-1:Cost]')),
		).toEqual([300, 580]);
		expect(costs(withFormulas("[-1:Rate]", "[1..-1:Rate]"))).toEqual([null, ["100"]]);
		expect(costs(withFormulas("count([1:1..3])", "[!:1..2].length"))).toEqual([3, 2]);
	});

	it("report loops and pass errors on", () => {
		const loop = costs(withFormulas("[2:Cost]", "[1:Cost]"));
		expect(loop.every((v) => isScriptError(v) && /Circular/.test(v.$error))).toBe(true);
		const missing = costs(withFormulas("[9:Rate]", "[1:Cost] + 1"));
		expect(missing).toEqual([
			{ $error: "There's no row 9." },
			{ $error: "Error in row 1 · Cost: There's no row 9." },
		]);
	});

	it("a runaway formula fails alone", () => {
		expect(
			costs(withFormulas("while (true) {}\nreturn 1;", "[@:Rate] + 1"), { ...LIMITS, timeMs: 100 }),
		).toEqual([{ $error: "The script took too long." }, 81]);
	});

	it("script columns and formulas read each other", () => {
		const result = run("return (row.Cost ?? 0) + [@:Cost];", withFormulas("[@:Rate] / 10", null));
		expect(result.values).toEqual([20, 0]);
	});
});

describe("resultKind", () => {
	it("is number, checkbox or date only when every value is one", () => {
		expect(resultKind([1, null, 2.5])).toBe("number");
		expect(resultKind([true, false])).toBe("checkbox");
		expect(resultKind(["2026-01-01", null])).toBe("date");
		expect(resultKind([1, "a"])).toBe("text");
		expect(resultKind([{ $error: "x" }, 3])).toBe("number");
		expect(resultKind([])).toBe("text");
	});
});
