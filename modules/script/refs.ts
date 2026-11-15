/**
 * Cell references in scripts and formulas, Excel-style: `[row:column]`.
 *
 * Each side is one of:
 * - `3`: a position, counting from 1 (rows in the database's own order,
 *   columns left to right with the title first);
 * - `-1`, `+2`: relative to the cell being worked out;
 * - `@`: the cell's own row (or column);
 * - `Rate`, `"Due date"`: a column by name, or a row by its title;
 * - `!`: every row (or column);
 * - `1..5`, `1..-1`: a range between two of the above.
 *
 * `[3:Rate]` is one value, `[!:Rate]` the whole column as a list, `[3:!]` the
 * whole row, `[1..-1:@]` everything above in this column, `[!:!]` a grid.
 *
 * `translateRefs` rewrites them as `__ref(row, column)` calls (see `run.ts`),
 * leaving strings, template text and comments alone.
 */

/** One side of a reference, as `__ref` reads it. */
export type RefAtom = ["@"] | ["#", number] | ["~", number] | ["$", string];
export type RefSpec = RefAtom | ["!"] | ["..", RefAtom, RefAtom];

const ATOM = String.raw`@|[+-]\d+|\d+|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[A-Za-z_$][\w$]*`;
const SIDE = String.raw`!|(?:${ATOM})(?:[ \t]*\.\.[ \t]*(?:${ATOM}))?`;
// On one line, so a rewritten script keeps its line numbers.
const REF = new RegExp(String.raw`\[[ \t]*(${SIDE})[ \t]*:[ \t]*(${SIDE})[ \t]*\]`, "y");

function atom(text: string): RefAtom {
	if (text === "@") return ["@"];
	if (/^[+-]\d+$/.test(text)) return ["~", Number(text)];
	if (/^\d+$/.test(text)) return ["#", Number(text)];
	if (text.startsWith('"') || text.startsWith("'"))
		return ["$", text.slice(1, -1).replace(/\\(.)/g, "$1")];
	return ["$", text];
}

export function parseSide(text: string): RefSpec {
	if (text === "!") return ["!"];
	const range = text.match(new RegExp(String.raw`^(${ATOM})[ \t]*\.\.[ \t]*(${ATOM})$`));
	return range ? ["..", atom(range[1]!), atom(range[2]!)] : atom(text);
}

/** Rewrites every `[row:column]` outside strings and comments. */
export function translateRefs(source: string): string {
	let out = "";
	let i = 0;
	// Template literals nest: `${` opens code inside one, the matching `}` goes back.
	const braces: ("code" | "template")[] = [];
	const n = source.length;
	const skipString = (quote: string) => {
		const start = i++;
		while (i < n && source[i] !== quote && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
		i++;
		out += source.slice(start, i);
	};
	/** Template text up to the closing backtick or the next `${`. */
	const templateText = () => {
		const start = i;
		while (i < n) {
			if (source[i] === "\\") i += 2;
			else if (source[i] === "`") {
				i++;
				break;
			} else if (source[i] === "$" && source[i + 1] === "{") {
				i += 2;
				braces.push("template");
				break;
			} else i++;
		}
		out += source.slice(start, i);
	};
	while (i < n) {
		const ch = source[i]!;
		const next = source[i + 1];
		if (ch === "/" && next === "/") {
			const end = source.indexOf("\n", i);
			const stop = end < 0 ? n : end;
			out += source.slice(i, stop);
			i = stop;
		} else if (ch === "/" && next === "*") {
			const end = source.indexOf("*/", i + 2);
			const stop = end < 0 ? n : end + 2;
			out += source.slice(i, stop);
			i = stop;
		} else if (ch === '"' || ch === "'") {
			skipString(ch);
		} else if (ch === "`") {
			out += ch;
			i++;
			templateText();
		} else if (ch === "{") {
			braces.push("code");
			out += ch;
			i++;
		} else if (ch === "}") {
			out += ch;
			i++;
			if (braces.pop() === "template") templateText();
		} else if (ch === "[") {
			REF.lastIndex = i;
			const match = REF.exec(source);
			if (match) {
				out += `__ref(${JSON.stringify(parseSide(match[1]!.trim()))}, ${JSON.stringify(parseSide(match[2]!.trim()))})`;
				i = REF.lastIndex;
			} else {
				out += ch;
				i++;
			}
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}
