/**
 * A page's saved editor state as HTML or Markdown, for the API. Pure functions
 * over the serialized JSON: no editor or DOM involved. What they need from the
 * database (page titles, synced blocks' latest content) comes in `Refs`.
 */

type Node = Record<string, unknown> & { type?: string; children?: Node[] };

export interface Refs {
	/** Titles of the pages that page links and database blocks point to. */
	titles: Record<string, string>;
	/** The latest content of synced blocks, by id (their own copy is used otherwise). */
	synced: Record<string, Node[]>;
	/** Where a link to another page goes. */
	pageHref(id: string): string;
	/** Where a file the app serves (`/files/…`) is fetched from. */
	fileHref(path: string): string;
}

/** Bits of a text node's `format`. */
const BOLD = 1;
const ITALIC = 2;
const STRIKE = 4;
const UNDERLINE = 8;
const CODE = 16;
const SUB = 32;
const SUP = 64;
const HIGHLIGHT = 128;

const INLINE = new Set([
	"text",
	"code-highlight",
	"linebreak",
	"tab",
	"link",
	"autolink",
	"page-link",
	"mark",
]);

const str = (value: unknown) => (typeof value === "string" ? value : "");
const kids = (node: Node): Node[] => (Array.isArray(node.children) ? node.children : []);
const isInline = (node: Node) =>
	INLINE.has(node.type ?? "") || (node.type === "equation" && node.inline === true);

/** The page ids and synced block ids a document refers to, to look up before rendering. */
export function refsIn(state: unknown): { pageIds: string[]; syncIds: string[] } {
	const pageIds = new Set<string>();
	const syncIds = new Set<string>();
	const walk = (node: Node) => {
		if (node.type === "page-link" && typeof node.pageId === "string") pageIds.add(node.pageId);
		if (node.type === "database" && typeof node.databaseId === "string")
			pageIds.add(node.databaseId);
		if (node.type === "synced" && typeof node.syncId === "string") syncIds.add(node.syncId);
		kids(node).forEach(walk);
	};
	const root = rootOf(state);
	if (root) walk(root);
	return { pageIds: [...pageIds], syncIds: [...syncIds] };
}

const rootOf = (state: unknown): Node | null => {
	const root = state && typeof state === "object" ? (state as { root?: unknown }).root : null;
	return root && typeof root === "object" ? (root as Node) : null;
};

/** The text inside a node, as search would read it. */
const textOf = (node: Node): string =>
	node.type === "linebreak"
		? " "
		: typeof node.text === "string"
			? node.text
			: kids(node).map(textOf).join("");

/** A heading's anchor: its words, lowercased and hyphenated. */
export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "section"
	);
}

interface Heading {
	level: number;
	text: string;
	id: string;
}

/** The document's headings, in order, each with a unique anchor. */
function headingsOf(root: Node, refs: Refs): Map<Node, Heading> {
	const found = new Map<Node, Heading>();
	const used = new Map<string, number>();
	const walk = (node: Node) => {
		if (node.type === "heading") {
			const text = textOf(node).replace(/\s+/g, " ").trim();
			const base = slug(text);
			const n = used.get(base) ?? 0;
			used.set(base, n + 1);
			found.set(node, {
				level: Number(str(node.tag).slice(1)) || 1,
				text,
				id: n === 0 ? base : `${base}-${n}`,
			});
		}
		for (const child of childrenOf(node, refs)) walk(child);
	};
	walk(root);
	return found;
}

/** A node's children; a synced block's are its latest content. */
const childrenOf = (node: Node, refs: Refs): Node[] => {
	if (node.type === "synced" && typeof node.syncId === "string") {
		const latest = refs.synced[node.syncId];
		if (Array.isArray(latest)) return latest;
	}
	return kids(node);
};

/** A path the app serves becomes `fileHref`'s; other links stay. */
const fileLink = (src: string, refs: Refs) =>
	src.startsWith("/files/") ? refs.fileHref(src) : src;

/** Only links that can't run script in the reader's page. */
const safeUrl = (url: string) =>
	/^(https?:|mailto:|tel:|\/|#)/i.test(url.trim()) ? url.trim() : "";

// ---------------------------------------------------------------- HTML

const esc = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot", "'": "#39" }[c]};`,
	);

const ALIGN = new Set(["left", "center", "right", "justify", "start", "end"]);
const alignAttr = (node: Node) =>
	ALIGN.has(str(node.format)) ? ` style="text-align:${str(node.format)}"` : "";

/** The page's content as HTML: semantic tags, with classes for what HTML has no tag for. */
export function toHtml(state: unknown, refs: Refs): string {
	const root = rootOf(state);
	if (!root) return "";
	const headings = headingsOf(root, refs);

	const inline = (nodes: Node[]): string => nodes.map(inlineNode).join("");
	const inlineNode = (node: Node): string => {
		switch (node.type) {
			case "text":
			case "code-highlight": {
				let html = esc(str(node.text));
				const format = Number(node.format) || 0;
				if (format & CODE) html = `<code>${html}</code>`;
				if (format & BOLD) html = `<strong>${html}</strong>`;
				if (format & ITALIC) html = `<em>${html}</em>`;
				if (format & UNDERLINE) html = `<u>${html}</u>`;
				if (format & STRIKE) html = `<s>${html}</s>`;
				if (format & HIGHLIGHT) html = `<mark>${html}</mark>`;
				if (format & SUB) html = `<sub>${html}</sub>`;
				if (format & SUP) html = `<sup>${html}</sup>`;
				return html;
			}
			case "linebreak":
				return "<br>";
			case "tab":
				return "\t";
			case "link":
			case "autolink": {
				const href = safeUrl(fileLink(str(node.url), refs));
				const title = str(node.title) ? ` title="${esc(str(node.title))}"` : "";
				return href
					? `<a href="${esc(href)}"${title}>${inline(kids(node))}</a>`
					: inline(kids(node));
			}
			case "page-link": {
				const id = str(node.pageId);
				const title = refs.titles[id];
				if (title === undefined) return "";
				return `<a href="${esc(refs.pageHref(id))}" data-page-id="${esc(id)}">${esc(title || "Untitled")}</a>`;
			}
			case "equation":
				return `<span class="math math-inline">${esc(`\\(${str(node.equation)}\\)`)}</span>`;
			case "mark":
				return inline(kids(node));
			default:
				return isInline(node) ? inline(kids(node)) : block(node);
		}
	};

	const blocks = (nodes: Node[]): string => {
		const out: string[] = [];
		for (const node of nodes) {
			const html = isInline(node) ? inlineNode(node) : block(node);
			if (html) out.push(html);
		}
		return out.join("\n");
	};

	const listItems = (list: Node): string =>
		kids(list)
			.map((item) => {
				const nested = kids(item).filter((c) => c.type === "list");
				const content = kids(item).filter((c) => c.type !== "list");
				// An item holding only a nested list is how Lexical indents.
				if (content.length === 0 && nested.length > 0)
					return `<li class="nested">${nested.map(block).join("")}</li>`;
				const check =
					list.listType === "check"
						? `<input type="checkbox" disabled${item.checked === true ? " checked" : ""}> `
						: "";
				return `<li${list.listType === "check" ? ` class="task${item.checked === true ? " done" : ""}"` : ""}>${check}${inline(content)}${nested.map(block).join("")}</li>`;
			})
			.join("");

	const block = (node: Node): string => {
		switch (node.type) {
			case "paragraph":
				return `<p${alignAttr(node)}>${inline(kids(node))}</p>`;
			case "heading": {
				const tag = /^h[1-6]$/.test(str(node.tag)) ? str(node.tag) : "h2";
				const id = headings.get(node)?.id;
				return `<${tag}${id ? ` id="${esc(id)}"` : ""}${alignAttr(node)}>${inline(kids(node))}</${tag}>`;
			}
			case "quote":
				return `<blockquote>${inline(kids(node))}</blockquote>`;
			case "list": {
				const ordered = node.listType === "number";
				const start = ordered && Number(node.start) > 1 ? ` start="${Number(node.start)}"` : "";
				const cls = node.listType === "check" ? ' class="tasks"' : "";
				return ordered
					? `<ol${start}>${listItems(node)}</ol>`
					: `<ul${cls}>${listItems(node)}</ul>`;
			}
			case "code": {
				const language = str(node.language);
				const code = esc(
					kids(node)
						.map((c) => (c.type === "linebreak" ? "\n" : c.type === "tab" ? "\t" : str(c.text)))
						.join(""),
				);
				if (language === "mermaid") return `<pre class="mermaid">${code}</pre>`;
				const cls = language ? ` class="language-${esc(language)}"` : "";
				return `<pre><code${cls}>${code}</code></pre>`;
			}
			case "divider":
			case "horizontalrule":
				return "<hr>";
			case "callout": {
				const emoji = str(node.emoji);
				return `<aside class="callout">${emoji ? `<span class="callout-icon">${esc(emoji)}</span> ` : ""}<div>${blocks(kids(node))}</div></aside>`;
			}
			case "toggle": {
				const title = kids(node).find((c) => c.type === "toggle-title");
				const body = kids(node).find((c) => c.type === "toggle-body");
				return `<details><summary>${title ? inline(kids(title)) : ""}</summary>\n${body ? blocks(kids(body)) : ""}\n</details>`;
			}
			case "columns": {
				const widths = Array.isArray(node.widths) ? (node.widths as number[]) : [];
				const columns = kids(node).map((column, i) => {
					const share = typeof widths[i] === "number" ? ` style="flex:${widths[i]}"` : "";
					return `<div class="column"${share}>${blocks(kids(column))}</div>`;
				});
				return `<div class="columns">${columns.join("")}</div>`;
			}
			case "synced":
				return blocks(childrenOf(node, refs));
			case "table":
				return `<table><tbody>${kids(node)
					.map(
						(row) =>
							`<tr>${kids(row)
								.map((cell) => {
									const tag = Number(cell.headerState) > 0 ? "th" : "td";
									const span = [
										Number(cell.colSpan) > 1 ? ` colspan="${Number(cell.colSpan)}"` : "",
										Number(cell.rowSpan) > 1 ? ` rowspan="${Number(cell.rowSpan)}"` : "",
									].join("");
									return `<${tag}${span}>${blocks(kids(cell))}</${tag}>`;
								})
								.join("")}</tr>`,
					)
					.join("")}</tbody></table>`;
			case "image": {
				const src = safeUrl(fileLink(str(node.src), refs));
				if (!src) return "";
				const width = typeof node.width === "number" ? ` width="${Math.round(node.width)}"` : "";
				const caption = str(node.caption);
				const img = `<img src="${esc(src)}" alt="${esc(str(node.alt))}"${width}>`;
				return `<figure>${img}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}</figure>`;
			}
			case "media": {
				const src = safeUrl(fileLink(str(node.src), refs));
				if (!src) return "";
				const name = esc(str(node.name));
				if (node.media === "audio")
					return `<figure class="audio"><audio controls preload="metadata" src="${esc(src)}"></audio><figcaption>${name}</figcaption></figure>`;
				if (node.media === "video")
					return `<figure class="video"><video controls preload="metadata" src="${esc(src)}"></video><figcaption>${name}</figcaption></figure>`;
				return `<p class="file pdf"><a href="${esc(src)}">${name || "PDF"}</a></p>`;
			}
			case "file": {
				const src = safeUrl(fileLink(str(node.src), refs));
				return src
					? `<p class="file"><a href="${esc(src)}">${esc(str(node.name) || "Download")}</a></p>`
					: "";
			}
			case "embed": {
				const url = safeUrl(str(node.url));
				if (!url) return "";
				const preview = (node.preview ?? {}) as Record<string, unknown>;
				const title = str(preview.title) || url;
				const description = str(preview.description);
				return `<figure class="embed"><a href="${esc(url)}">${esc(title)}</a>${description ? `<figcaption>${esc(description)}</figcaption>` : ""}</figure>`;
			}
			case "equation":
				return `<div class="math math-display">${esc(`\\[${str(node.equation)}\\]`)}</div>`;
			case "toc": {
				const entries = [...headings.values()];
				if (entries.length === 0) return "";
				const top = Math.min(...entries.map((e) => e.level));
				return `<nav class="toc"><ul>${entries
					.map(
						(e) =>
							`<li class="toc-level-${e.level - top}"><a href="#${esc(e.id)}">${esc(e.text)}</a></li>`,
					)
					.join("")}</ul></nav>`;
			}
			case "database": {
				const id = str(node.databaseId);
				const title = refs.titles[id];
				return title === undefined
					? ""
					: `<p class="database"><a href="${esc(refs.pageHref(id))}" data-page-id="${esc(id)}">${esc(title || "Untitled")}</a></p>`;
			}
			default:
				// Something newer than this renderer: keep its text.
				return kids(node).length > 0 ? blocks(kids(node)) : "";
		}
	};

	return blocks(kids(root));
}

// ---------------------------------------------------------------- Markdown

/** Escapes what Markdown would read as syntax. */
const mdEscape = (text: string) => text.replace(/([\\`*_[\]<>~|=$])/g, "\\$1");

/** At a line's start, what would make it a heading, list or quote. */
const lineStart = (text: string) =>
	text.replace(
		/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/,
		(_, space: string, mark: string) =>
			`${space}${mark.replace(/^(\d+)([.)])$/, "$1\\$2").replace(/^([#>+-])$/, "\\$1")}`,
	);

/** The page's content as Markdown (GitHub's): HTML for what Markdown has no syntax for. */
export function toMarkdown(state: unknown, refs: Refs): string {
	const root = rootOf(state);
	if (!root) return "";
	const headings = headingsOf(root, refs);

	const inline = (nodes: Node[]): string => nodes.map(inlineNode).join("");
	const inlineNode = (node: Node): string => {
		switch (node.type) {
			case "text":
			case "code-highlight": {
				const text = str(node.text);
				const format = Number(node.format) || 0;
				if (format & CODE) {
					const fence = text.includes("`") ? "``" : "`";
					return `${fence}${text.startsWith("`") ? " " : ""}${text}${text.endsWith("`") ? " " : ""}${fence}`;
				}
				// Markers go inside the spaces around the text, or they wouldn't count.
				const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
				if (!core) return text;
				let md = mdEscape(core);
				if (format & BOLD) md = `**${md}**`;
				if (format & ITALIC) md = `_${md}_`;
				if (format & STRIKE) md = `~~${md}~~`;
				if (format & UNDERLINE) md = `<u>${md}</u>`;
				if (format & HIGHLIGHT) md = `==${md}==`;
				if (format & SUB) md = `<sub>${md}</sub>`;
				if (format & SUP) md = `<sup>${md}</sup>`;
				return lead + md + trail;
			}
			case "linebreak":
				return "\\\n";
			case "tab":
				return "\t";
			case "link":
			case "autolink": {
				const href = safeUrl(fileLink(str(node.url), refs));
				const text = inline(kids(node));
				return href ? `[${text}](${mdUrl(href)})` : text;
			}
			case "page-link": {
				const id = str(node.pageId);
				const title = refs.titles[id];
				return title === undefined
					? ""
					: `[${mdEscape(title || "Untitled")}](${mdUrl(refs.pageHref(id))})`;
			}
			case "equation":
				return `$${str(node.equation)}$`;
			default:
				return inline(kids(node));
		}
	};

	/** Inline content of a block, each line escaped where it would start a block. */
	const line = (nodes: Node[]) =>
		inline(nodes)
			.split("\n")
			.map((l) => lineStart(l))
			.join("\n");

	const indent = (text: string, by: string) =>
		text
			.split("\n")
			.map((l, i) => (i === 0 || l === "" ? l : by + l))
			.join("\n");

	const list = (node: Node): string => {
		let n = Math.max(1, Number(node.start) || 1);
		const items: string[] = [];
		for (const item of kids(node)) {
			const nested = kids(item).filter((c) => c.type === "list");
			const content = kids(item).filter((c) => c.type !== "list");
			const inner = nested.map(list);
			if (content.length === 0 && nested.length > 0) {
				// Lexical's indented items: nest under the previous one.
				const by = items.length > 0 ? " ".repeat(markerOf(node, n - 1, item).length) : "";
				const nestedText = inner.map((t) => by + indent(t, by)).join("\n");
				if (items.length > 0) items[items.length - 1] += `\n${nestedText}`;
				else items.push(nestedText);
				continue;
			}
			const marker = markerOf(node, n, item);
			const pad = " ".repeat(marker.length);
			let text = `${marker}${indent(line(content), pad)}`;
			for (const t of inner) text += `\n${pad}${indent(t, pad)}`;
			items.push(text);
			n += 1;
		}
		return items.join("\n");
	};

	const block = (node: Node): string => {
		switch (node.type) {
			case "paragraph":
				return line(kids(node));
			case "heading": {
				const level = Math.min(6, Number(str(node.tag).slice(1)) || 2);
				return `${"#".repeat(level)} ${inline(kids(node)).replace(/\\\n/g, " ")}`;
			}
			case "quote":
				return line(kids(node))
					.split("\n")
					.map((l) => `> ${l}`)
					.join("\n");
			case "list":
				return list(node);
			case "code": {
				const code = kids(node)
					.map((c) => (c.type === "linebreak" ? "\n" : c.type === "tab" ? "\t" : str(c.text)))
					.join("");
				const fence = code.includes("```") ? "````" : "```";
				return `${fence}${str(node.language)}\n${code}\n${fence}`;
			}
			case "divider":
			case "horizontalrule":
				return "---";
			case "callout": {
				const emoji = str(node.emoji);
				const body = line(kids(node));
				return `${emoji ? `${emoji} ` : ""}${body}`
					.split("\n")
					.map((l) => `> ${l}`)
					.join("\n");
			}
			case "toggle": {
				const title = kids(node).find((c) => c.type === "toggle-title");
				const body = kids(node).find((c) => c.type === "toggle-body");
				const summary = title ? inline(kids(title)).replace(/\\\n/g, " ") : "";
				return `<details>\n<summary>${summary}</summary>\n\n${body ? blocks(kids(body)) : ""}\n\n</details>`;
			}
			case "columns":
				return kids(node)
					.map((column) => blocks(kids(column)))
					.filter(Boolean)
					.join("\n\n");
			case "synced":
				return blocks(childrenOf(node, refs));
			case "table":
				return table(node);
			case "image": {
				const src = safeUrl(fileLink(str(node.src), refs));
				if (!src) return "";
				const caption = str(node.caption);
				return `![${mdEscape(str(node.alt))}](${mdUrl(src)}${caption ? ` "${caption.replace(/"/g, '\\"')}"` : ""})`;
			}
			case "media":
			case "file": {
				const src = safeUrl(fileLink(str(node.src), refs));
				return src ? `[${mdEscape(str(node.name) || "Download")}](${mdUrl(src)})` : "";
			}
			case "embed": {
				const url = safeUrl(str(node.url));
				if (!url) return "";
				const preview = (node.preview ?? {}) as Record<string, unknown>;
				return `[${mdEscape(str(preview.title) || url)}](${mdUrl(url)})`;
			}
			case "equation":
				return `$$\n${str(node.equation)}\n$$`;
			case "toc": {
				const entries = [...headings.values()];
				if (entries.length === 0) return "";
				const top = Math.min(...entries.map((e) => e.level));
				return entries
					.map((e) => `${"  ".repeat(e.level - top)}- [${mdEscape(e.text)}](#${e.id})`)
					.join("\n");
			}
			case "database": {
				const id = str(node.databaseId);
				const title = refs.titles[id];
				return title === undefined
					? ""
					: `[${mdEscape(title || "Untitled")}](${mdUrl(refs.pageHref(id))})`;
			}
			default:
				return kids(node).length > 0 ? blocks(kids(node)) : "";
		}
	};

	const table = (node: Node): string => {
		const rows = kids(node).map((row) =>
			kids(row).map((cell) =>
				kids(cell)
					.map((c) => (isInline(c) ? inlineNode(c) : block(c)))
					.join("<br>")
					.replace(/\\\n|\n/g, "<br>")
					.replace(/(?<!\\)\|/g, "\\|"),
			),
		);
		const width = Math.max(1, ...rows.map((r) => r.length));
		const pad = (r: string[]) => [...r, ...Array<string>(width - r.length).fill("")];
		const [head = [], ...body] = rows;
		const fmt = (r: string[]) => `| ${pad(r).join(" | ")} |`;
		return [fmt(head), `|${" --- |".repeat(width)}`, ...body.map(fmt)].join("\n");
	};

	const blocks = (nodes: Node[]): string => {
		const out: string[] = [];
		for (const node of nodes) {
			const md = isInline(node) ? line([node]) : block(node);
			if (md !== "" || node.type === "paragraph") out.push(md);
		}
		// Empty paragraphs are spacing in the editor; in Markdown, one blank line separates blocks.
		return out
			.filter((md, i) => md !== "" || (i > 0 && out[i - 1] !== ""))
			.filter((md) => md !== "")
			.join("\n\n");
	};

	return blocks(kids(root));
}

const markerOf = (list: Node, n: number, item: Node) =>
	list.listType === "number"
		? `${n}. `
		: list.listType === "check"
			? `- [${item.checked === true ? "x" : " "}] `
			: "- ";

/** A link target that doesn't end the link early. */
const mdUrl = (url: string) =>
	/[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
