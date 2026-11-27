/**
 * A comment's Markdown, as the API reads and writes pages: shown as HTML, and
 * turned into (and back from) the comment box's editor state.
 */
import { mentionEmail } from "#lib/editor/extensions/mention/logic.ts";
import { icon } from "#lib/icons.ts";
import { fromMarkdown } from "#modules/api/markdown.ts";
import { toHtml, toMarkdown, type Refs } from "#modules/api/render.ts";
import { pageHref, titleOf } from "#modules/workspace/client/page-directory.ts";

/** Page titles as the reader sees them: links to pages they can't see are left out. */
const refs: Refs = {
	titles: new Proxy({} as Record<string, string>, {
		get: (_, id) => (typeof id === "string" ? (titleOf(id) ?? undefined) : undefined),
	}),
	synced: {},
	pageHref,
	fileHref: (path) => path,
};

/** A comment's body: mentions as chips, links to pages with their titles. */
export function commentBody(markdown: string): HTMLElement {
	const body = document.createElement("div");
	body.className = "cm-body";
	body.innerHTML = toHtml(fromMarkdown(markdown), refs);
	for (const link of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
		const email = mentionEmail(link.getAttribute("href") ?? "", link.textContent ?? "");
		if (email) {
			const chip = document.createElement("span");
			chip.className = "cm-mention";
			chip.textContent = link.textContent;
			chip.title = email;
			link.replaceWith(chip);
		} else if (link.dataset.pageId) {
			link.classList.add("cm-ref");
			link.insertAdjacentHTML("afterbegin", icon("fileText", 14));
		} else {
			link.target = "_blank";
			link.rel = "noopener noreferrer";
		}
	}
	return body;
}

/** The comment box's document as Markdown. */
export const toCommentMarkdown = (json: string): string =>
	toMarkdown(JSON.parse(json) as unknown, refs).trim();

type Node = Record<string, unknown> & { type?: string; children?: Node[] };

/** What the comment box can hold; anything else is kept as its text. */
const BLOCKS = new Set(["paragraph", "heading", "quote", "list"]);
const INLINE = new Set(["text", "linebreak", "tab", "link", "autolink", "page-link"]);

const textOf = (node: Node): string => {
	if (typeof node.text === "string") return node.text;
	if (typeof node.equation === "string") return "$" + node.equation + "$";
	return (node.children ?? []).map(textOf).join("");
};

const plain = (text: string): Node => ({
	type: "text",
	text,
	detail: 0,
	format: 0,
	mode: "normal",
	style: "",
	version: 1,
});

const paragraph = (children: Node[]): Node => ({
	type: "paragraph",
	children,
	direction: null,
	format: "",
	indent: 0,
	textFormat: 0,
	textStyle: "",
	version: 1,
});

function cleanInline(nodes: Node[]): Node[] {
	return nodes.map((node) => {
		if (!INLINE.has(node.type ?? "")) return plain(textOf(node));
		return node.children ? { ...node, children: cleanInline(node.children) } : node;
	});
}

function cleanBlock(node: Node): Node {
	if (node.type === "list")
		return {
			...node,
			children: (node.children ?? []).map((item) => ({
				...item,
				children: (item.children ?? []).map((child) =>
					child.type === "list" ? cleanBlock(child) : (cleanInline([child])[0] ?? plain("")),
				),
			})),
		};
	if (BLOCKS.has(node.type ?? "")) return { ...node, children: cleanInline(node.children ?? []) };
	return paragraph([plain(textOf(node))]);
}

/** A comment's Markdown as the comment box's editor state. */
export function commentState(markdown: string): string {
	const state = fromMarkdown(markdown) as { root: Node };
	const children = (state.root.children ?? []).map(cleanBlock);
	return JSON.stringify({ root: { ...state.root, children } });
}
