/**
 * Markdown (GitHub's, and what `toMarkdown` writes) into the editor's saved
 * state, for pages written through the API. Headings, paragraphs, lists
 * (bullets, numbers, tasks), quotes, code, dividers, tables, images, toggles
 * (`<details>`), equations (`$…$`, `$$…$$`), links and inline formatting.
 * Links to `/p/<id>` become page links.
 */

type Node = Record<string, unknown>;

const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;
const CODE = 16;
const SUB = 32;
const SUP = 64;
const HIGHLIGHT = 128;

const PAGE_PATH =
	/^(?:https?:\/\/[^/]+)?\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
/** The app's files, given as the app's path or the API's URL for them. */
const FILE_PATH =
	/^(?:https?:\/\/[^/]+)?(?:\/api\/v1)?(\/files\/(?:img|file|media)\/[\w.-]+)(\?.*)?$/;

const element = (type: string, children: Node[], extra: Node = {}): Node => ({
	children,
	direction: null,
	format: "",
	indent: 0,
	type,
	version: 1,
	...extra,
});

const text = (value: string, format = 0, type = "text"): Node => ({
	detail: 0,
	format,
	mode: "normal",
	style: "",
	text: value,
	type,
	version: 1,
});

const paragraph = (children: Node[]) =>
	element("paragraph", children, { textFormat: 0, textStyle: "" });

/** A path of the app's own for its files, so the page keeps working when the API's URL changes. */
const ownFile = (src: string) => FILE_PATH.exec(src)?.[1] ?? src;

// ---------------------------------------------------------------- inline

/** Text with Markdown's inline syntax, as text, link, page-link, equation and line break nodes. */
export function parseInline(source: string, format = 0): Node[] {
	const out: Node[] = [];
	let plain = "";
	const flush = () => {
		if (plain) out.push(text(plain, format));
		plain = "";
	};
	const push = (...nodes: Node[]) => {
		flush();
		out.push(...nodes);
	};
	/** The index of `close` after `from`, not escaped; -1 when there's none. */
	const find = (close: string, from: number) => {
		for (let j = from; j <= source.length - close.length; j++) {
			if (source[j] === "\\") {
				j++;
				continue;
			}
			if (source.startsWith(close, j)) return j;
		}
		return -1;
	};
	const wrap = (open: string, close: string, bit: number, i: number) => {
		const end = find(close, i + open.length);
		if (end <= i + open.length) return -1;
		const inner = source.slice(i + open.length, end);
		if (/^\s|\s$/.test(inner) && open !== "<u>" && open !== "<sub>" && open !== "<sup>") return -1;
		push(...parseInline(inner, format | bit));
		return end + close.length;
	};

	let i = 0;
	while (i < source.length) {
		const c = source[i]!;
		const rest = source.slice(i);
		let next = -1;

		if (c === "\\" && i + 1 < source.length) {
			if (source[i + 1] === "\n") {
				push({ type: "linebreak", version: 1 });
				i += 2;
				continue;
			}
			if (/[!-/:-@[-`{-~]/.test(source[i + 1]!)) {
				plain += source[i + 1];
				i += 2;
				continue;
			}
		}
		if (c === "\n") {
			push({ type: "linebreak", version: 1 });
			i++;
			continue;
		}
		if (c === "`") {
			const fence = /^`+/.exec(rest)![0];
			const end = source.indexOf(fence, i + fence.length);
			if (end > i) {
				let code = source.slice(i + fence.length, end);
				if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
				push(text(code, format | CODE));
				i = end + fence.length;
				continue;
			}
		}
		if (/^<br\s*\/?>/i.test(rest)) {
			push({ type: "linebreak", version: 1 });
			i += /^<br\s*\/?>/i.exec(rest)![0].length;
			continue;
		}
		if (rest.startsWith("**")) next = wrap("**", "**", BOLD, i);
		else if (rest.startsWith("__") && !/\w/.test(source[i - 1] ?? ""))
			next = wrap("__", "__", BOLD, i);
		else if (rest.startsWith("~~")) next = wrap("~~", "~~", STRIKE, i);
		else if (rest.startsWith("==")) next = wrap("==", "==", HIGHLIGHT, i);
		else if (rest.startsWith("<u>")) next = wrap("<u>", "</u>", UNDERLINE, i);
		else if (rest.startsWith("<sub>")) next = wrap("<sub>", "</sub>", SUB, i);
		else if (rest.startsWith("<sup>")) next = wrap("<sup>", "</sup>", SUP, i);
		else if (rest.startsWith("<mark>")) next = wrap("<mark>", "</mark>", HIGHLIGHT, i);
		else if (c === "*") next = wrap("*", "*", ITALIC, i);
		else if (c === "_" && !/\w/.test(source[i - 1] ?? "")) {
			// Not inside a word: snake_case stays as it is.
			const end = find("_", i + 1);
			if (end > i + 1 && !/\w/.test(source[end + 1] ?? "")) next = wrap("_", "_", ITALIC, i);
		} else if (c === "$" && source[i + 1] !== "$" && source[i + 1] !== " ") {
			const end = find("$", i + 1);
			if (end > i + 1 && source[end - 1] !== " ") {
				push({ type: "equation", version: 1, equation: source.slice(i + 1, end), inline: true });
				next = end + 1;
			}
		} else if (c === "[") {
			const link = parseLink(source, i);
			if (link) {
				const page = PAGE_PATH.exec(link.url);
				if (page) push({ type: "page-link", version: 1, pageId: page[1]!.toLowerCase() });
				else
					push(
						element("link", parseInline(link.text, format), {
							rel: "noreferrer",
							target: null,
							title: link.title,
							url: ownFile(link.url),
						}),
					);
				next = link.end;
			}
		} else if (c === "<") {
			const auto = /^<(https?:\/\/[^\s<>]+|mailto:[^\s<>]+)>/.exec(rest);
			if (auto) {
				push(
					element("link", [text(auto[1]!, format)], {
						rel: "noreferrer",
						target: null,
						title: null,
						url: auto[1],
					}),
				);
				next = i + auto[0].length;
			}
		}
		if (next > i) {
			i = next;
			continue;
		}
		plain += c;
		i++;
	}
	flush();
	return out;
}

/** `[text](url "title")` starting at `i`. */
function parseLink(source: string, i: number) {
	let depth = 0;
	let j = i;
	for (; j < source.length; j++) {
		const c = source[j];
		if (c === "\\") {
			j++;
			continue;
		}
		if (c === "[") depth++;
		if (c === "]" && --depth === 0) break;
	}
	if (source[j] !== "]" || source[j + 1] !== "(") return null;
	const target =
		/^\(\s*(<[^>]*>|[^\s()]*(?:\([^\s()]*\)[^\s()]*)*)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)/.exec(
			source.slice(j + 1),
		);
	if (!target) return null;
	const url = target[1]!.replace(/^<|>$/g, "");
	return {
		text: source.slice(i + 1, j),
		url,
		title: target[2] ? target[2].replace(/\\(.)/g, "$1") : null,
		end: j + 1 + target[0].length,
	};
}

// ---------------------------------------------------------------- blocks

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+|$)(.*)$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
/** A link alone on its line. */
const LINK_LINE = /^\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|\S+?)\s*\)$/;

/** What a media file plays as, by its extension (as `Files.store` names them). */
const mediaKind = (path: string) =>
	/\.(m4a|mp3|aac|ogg|flac|wav)$/i.test(path) ? "audio" : /\.pdf$/i.test(path) ? "pdf" : "video";

/**
 * A link alone on its line to an attachment or a media file of the app's: the
 * file or media block it was written from (its size isn't known, so it's 0).
 */
function fileBlock(line: string): Node | null {
	const link = LINK_LINE.exec(line);
	const src = link ? FILE_PATH.exec(link[2]!.replace(/^<|>$/g, ""))?.[1] : undefined;
	if (!link || !src || src.startsWith("/files/img/")) return null;
	const name = link[1]!.replace(/\\(.)/g, "$1");
	if (src.startsWith("/files/file/")) return { type: "file", version: 1, src, name, size: 0 };
	return { type: "media", version: 1, media: mediaKind(src), src, name, size: 0 };
}

const IMAGE = /^!\[((?:[^\]\\]|\\.)*)\]\(\s*(<[^>]*>|\S+?)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)$/;

const indentOf = (line: string) => /^\s*/.exec(line.replace(/\t/g, "    "))![0].length;
const blank = (line: string) => line.trim() === "";

/** Markdown as the editor's saved state (`{root: …}`). */
export function fromMarkdown(markdown: string): { root: Node } {
	const children = parseBlocks(markdown.replace(/\r\n?/g, "\n").split("\n"));
	return { root: element("root", children.length > 0 ? children : [paragraph([])]) };
}

/** Blocks for these top-level nodes, as `fromMarkdown` makes them (to add to a page). */
export const markdownBlocks = (markdown: string) => fromMarkdown(markdown).root.children as Node[];

function parseBlocks(lines: string[]): Node[] {
	const out: Node[] = [];
	let i = 0;
	const startsBlock = (line: string, next?: string) =>
		HEADING.test(line) ||
		FENCE.test(line) ||
		RULE.test(line) ||
		/^\s*>/.test(line) ||
		LIST_ITEM.test(line) ||
		/^\s*\$\$/.test(line) ||
		/^\s*<details\b/i.test(line) ||
		(line.includes("|") && next !== undefined && TABLE_RULE.test(next) && next.includes("-"));

	while (i < lines.length) {
		const line = lines[i]!;
		if (blank(line)) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const close = new RegExp(`^\\s*${fence[2]![0]}{${fence[2]!.length},}\\s*$`);
			const body: string[] = [];
			i++;
			while (i < lines.length && !close.test(lines[i]!)) body.push(lines[i++]!);
			i++;
			const code: Node[] = [];
			body.forEach((l, n) => {
				if (n > 0) code.push({ type: "linebreak", version: 1 });
				if (l) code.push(text(l, 0, "code-highlight"));
			});
			out.push(element("code", code, { language: fence[3] || null }));
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			const level = Math.min(3, heading[1]!.length);
			out.push(element("heading", parseInline(heading[2]!), { tag: `h${level}` }));
			i++;
			continue;
		}

		if (RULE.test(line)) {
			out.push({ type: "divider", version: 1 });
			i++;
			continue;
		}

		if (/^\s*\$\$/.test(line)) {
			const body: string[] = [];
			const first = line.trim().slice(2);
			if (first.endsWith("$$") && first.length > 2) {
				body.push(first.slice(0, -2));
				i++;
			} else {
				if (first) body.push(first);
				i++;
				while (i < lines.length && !/\$\$\s*$/.test(lines[i]!)) body.push(lines[i++]!);
				const last = (lines[i] ?? "").replace(/\$\$\s*$/, "");
				if (last.trim()) body.push(last);
				i++;
			}
			out.push({ type: "equation", version: 1, equation: body.join("\n").trim(), inline: false });
			continue;
		}

		if (/^\s*<details\b/i.test(line)) {
			const open = /\bopen\b/i.test(line);
			let depth = 0;
			const body: string[] = [];
			for (; i < lines.length; i++) {
				const l = lines[i]!;
				depth += (l.match(/<details\b/gi) ?? []).length;
				depth -= (l.match(/<\/details>/gi) ?? []).length;
				body.push(l);
				if (depth <= 0) break;
			}
			i++;
			let inner = body
				.join("\n")
				.replace(/^\s*<details\b[^>]*>/i, "")
				.replace(/<\/details>\s*$/i, "");
			let title = "";
			inner = inner.replace(/^\s*<summary>([\s\S]*?)<\/summary>/i, (_, t: string) => {
				title = t.trim();
				return "";
			});
			const content = parseBlocks(inner.split("\n"));
			out.push(
				element(
					"toggle",
					[
						element("toggle-title", parseInline(title)),
						element("toggle-body", content.length > 0 ? content : [paragraph([])]),
					],
					{ open },
				),
			);
			continue;
		}

		if (/^\s*>/.test(line)) {
			const body: string[] = [];
			while (i < lines.length && /^\s*>/.test(lines[i]!))
				body.push(lines[i++]!.replace(/^\s*>\s?/, ""));
			out.push(element("quote", parseInline(body.join("\n").replace(/\\\n/g, "\n").trim())));
			continue;
		}

		if (LIST_ITEM.test(line)) {
			const end = listEnd(lines, i);
			out.push(...parseList(lines.slice(i, end)));
			i = end;
			continue;
		}

		const next = lines[i + 1];
		if (line.includes("|") && next !== undefined && TABLE_RULE.test(next) && next.includes("-")) {
			const rows = [line];
			i += 2;
			while (i < lines.length && lines[i]!.includes("|") && !blank(lines[i]!))
				rows.push(lines[i++]!);
			out.push(table(rows));
			continue;
		}

		const attached = fileBlock(line.trim());
		if (attached) {
			out.push(attached);
			i++;
			continue;
		}

		const image = IMAGE.exec(line.trim());
		if (image) {
			out.push({
				type: "image",
				version: 1,
				src: ownFile(image[2]!.replace(/^<|>$/g, "")),
				alt: image[1]!.replace(/\\(.)/g, "$1"),
				width: null,
				caption: image[3]?.replace(/\\(.)/g, "$1") ?? "",
			});
			i++;
			continue;
		}

		// A paragraph: lines up to a blank one or the start of another block.
		const body = [line.trim()];
		i++;
		while (i < lines.length && !blank(lines[i]!) && !startsBlock(lines[i]!, lines[i + 1]))
			body.push(lines[i++]!.trim());
		out.push(
			paragraph(
				parseInline(
					body
						.join("\n")
						.replace(/\\\n/g, "\n")
						.replace(/ {2,}\n/g, "\n"),
				),
			),
		);
	}
	return out;
}

/** Where the list starting at `start` ends: at a blank line followed by something that isn't in it. */
function listEnd(lines: string[], start: number): number {
	let i = start + 1;
	while (i < lines.length) {
		const line = lines[i]!;
		if (blank(line)) {
			const next = lines.slice(i).find((l) => !blank(l));
			if (next === undefined || (!LIST_ITEM.test(next) && indentOf(next) < 2)) return i;
			i++;
			continue;
		}
		if (
			!LIST_ITEM.test(line) &&
			indentOf(line) === 0 &&
			/^(#|```|~~~|>|\$\$|<details)/.test(line.trim())
		)
			return i;
		i++;
	}
	return i;
}

interface Item {
	kind: "bullet" | "number" | "check";
	checked?: boolean;
	start: number;
	lines: string[];
	indent: number;
}

/** The items of a list (and lists right after it of another kind). */
function parseList(lines: string[]): Node[] {
	const base = indentOf(lines[0]!);
	const items: Item[] = [];
	for (const line of lines) {
		const match = LIST_ITEM.exec(line);
		if (match && indentOf(line) <= base + 1) {
			const marker = match[2]!;
			let content = match[3]!;
			let kind: Item["kind"] = /\d/.test(marker) ? "number" : "bullet";
			let checked: boolean | undefined;
			const task = /^\[([ xX])\](?:\s+|$)(.*)$/.exec(content);
			if (task && kind === "bullet") {
				kind = "check";
				checked = task[1] !== " ";
				content = task[2]!;
			}
			items.push({
				kind,
				checked,
				start: Number.parseInt(marker, 10) || 1,
				lines: [content],
				indent: indentOf(line) + marker.length + 1,
			});
		} else if (items.length > 0) {
			items[items.length - 1]!.lines.push(line);
		}
	}

	const lists: Node[] = [];
	let current: Node | null = null;
	let n = 1;
	for (const item of items) {
		if (!current || current.listType !== item.kind) {
			n = item.kind === "number" ? item.start : 1;
			current = element("list", [], {
				listType: item.kind,
				start: n,
				tag: item.kind === "number" ? "ol" : "ul",
			});
			lists.push(current);
		}
		const [first = "", ...more] = item.lines;
		// Lines indented under the item: more of its text, or a nested list.
		const nestedAt = more.findIndex((l) => LIST_ITEM.test(l) && indentOf(l) > base + 1);
		const textLines = [first, ...(nestedAt < 0 ? more : more.slice(0, nestedAt))]
			.filter((l) => !blank(l))
			.map((l) => l.trim());
		const nested = nestedAt < 0 ? [] : more.slice(nestedAt);
		const children = current.children as Node[];
		const extra: Node = { value: n++ };
		if (item.kind === "check") extra.checked = item.checked === true;
		children.push(
			element("listitem", parseInline(textLines.join("\n").replace(/\\\n/g, "\n")), extra),
		);
		if (nested.some((l) => !blank(l))) {
			const dedent = Math.min(...nested.filter((l) => !blank(l)).map(indentOf));
			const sub = parseList(
				nested.filter((l) => !blank(l)).map((l) => l.replace(/\t/g, "    ").slice(dedent)),
			);
			// Lexical indents with an item holding only the nested list.
			children.push(element("listitem", sub, { value: n }));
		}
	}
	return lists;
}

/** A GitHub table; its first row is the header. */
function table(rows: string[]): Node {
	const cells = (row: string) =>
		row
			.trim()
			.replace(/^\||(?<!\\)\|$/g, "")
			.split(/(?<!\\)\|/)
			.map((cell) => cell.trim().replace(/\\\|/g, "|"));
	const parsed = rows.map(cells);
	const width = Math.max(...parsed.map((r) => r.length));
	return element(
		"table",
		parsed.map((row, r) =>
			element(
				"tablerow",
				Array.from({ length: width }, (_, c) =>
					element(
						"tablecell",
						[paragraph(parseInline((row[c] ?? "").replace(/<br\s*\/?>/gi, "\n")))],
						{
							backgroundColor: null,
							colSpan: 1,
							headerState: r === 0 ? 1 : 0,
							rowSpan: 1,
						},
					),
				),
			),
		),
	);
}
