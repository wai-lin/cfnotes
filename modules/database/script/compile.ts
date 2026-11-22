/**
 * TypeScript to JavaScript for script properties, with Sucrase (types are
 * stripped, nothing is checked). Browser only: the editor compiles and sends
 * both the source and the result. Running is what's sealed off (see `run.ts`),
 * so the server needn't compile anything itself.
 */
import { transform } from "sucrase";

import { translateRefs } from "./refs.ts";
import { MAX_JS, MAX_SOURCE, type ScriptConfig } from "./script.ts";

/** The wrapper's first line (strict mode, so writing to the read-only data throws) pushes the reader's code down one line. */
const WRAP_START = 'function __script(row, rows, db) { "use strict";\n';

/**
 * TypeScript to JavaScript (types are stripped, nothing is checked). The source
 * is a function body, so `return` works at the top level.
 */
export function compileScript(source: string): ScriptConfig {
	const clipped = source.slice(0, MAX_SOURCE);
	return compileBody(clipped, clipped);
}

/**
 * A cell formula (what follows its `=`): an expression, like Excel's, or a
 * function body with its own `return` for anything longer.
 */
export function compileFormula(source: string): ScriptConfig {
	const clipped = source.slice(0, MAX_SOURCE);
	const body = /(^|[\s;{}])return\b/.test(clipped) ? clipped : `return (${clipped}\n);`;
	return compileBody(clipped, body);
}

function compileBody(clipped: string, body: string): ScriptConfig {
	// An expression's wrapper adds a line; an error there is on the reader's last one.
	const lines = clipped.split("\n").length;
	try {
		const { code } = transform(`${WRAP_START}${translateRefs(body)}\n}`, {
			transforms: ["typescript"],
			disableESTransforms: true,
		});
		if (code.length > MAX_JS) return { source: clipped, js: "", error: "The script is too long." };
		return { source: clipped, js: code };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Sucrase says "(line:column)"; count the reader's lines.
		const fixed = message.replace(
			/\((\d+):(\d+)\)/,
			(_, line: string, col: string) =>
				`(line ${Math.min(lines, Math.max(1, Number(line) - 1))}, column ${Number(col) + 1})`,
		);
		return { source: clipped, js: "", error: fixed.slice(0, 500) };
	}
}
