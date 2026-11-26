/**
 * Changing part of a page, for the MCP server: the section under a heading
 * (replaced, added to, deleted, or something put before or after it), and
 * find-and-replace in its text. Edits apply in order to the content as it is
 * now and are saved together, so one that fails leaves the page as it was.
 * A section is a top-level heading and what follows it, up to the next
 * heading of the same level or higher.
 */
import { Effect, Schema } from "effect";
import { BadRequest } from "spacefn";

import { livePage, parseJson, saveDoc } from "./api.ts";
import { fromMarkdown, markdownBlocks } from "./markdown.ts";

type Node = { type?: string; tag?: string; text?: string; children?: Node[] } & Record<
	string,
	unknown
>;

const bad = (message: string) => new BadRequest({ message });

const Heading = {
	/** The heading's text; `## Text` also says its level. */
	heading: Schema.String,
	/** Which one, counting from 1, when several headings say the same. */
	occurrence: Schema.optional(Schema.Number),
};

export const PageEdit = Schema.Union([
	Schema.Struct({
		action: Schema.Literal("replace_section"),
		...Heading,
		markdown: Schema.String,
	}),
	Schema.Struct({
		action: Schema.Literal("append_to_section"),
		...Heading,
		markdown: Schema.String,
	}),
	Schema.Struct({ action: Schema.Literal("insert_before"), ...Heading, markdown: Schema.String }),
	Schema.Struct({ action: Schema.Literal("insert_after"), ...Heading, markdown: Schema.String }),
	Schema.Struct({ action: Schema.Literal("delete_section"), ...Heading }),
	Schema.Struct({
		action: Schema.Literal("replace_text"),
		find: Schema.String,
		replace: Schema.String,
		/** Every match; otherwise there must be exactly one. */
		all: Schema.optional(Schema.Boolean),
	}),
]);
export type PageEdit = typeof PageEdit.Type;

const textOf = (node: Node): string =>
	typeof node.text === "string" ? node.text : (node.children ?? []).map(textOf).join("");

const levelOf = (node: Node) =>
	node.type === "heading" && typeof node.tag === "string" ? Number(node.tag.slice(1)) || 1 : null;

/** The top-level headings, as `## Text`. */
const outline = (blocks: Node[]) =>
	blocks.flatMap((b) => {
		const level = levelOf(b);
		return level === null ? [] : [`${"#".repeat(level)} ${textOf(b).trim()}`];
	});

/** Where the section under `heading` starts and ends in `blocks` (`end` is past its last block). */
function sectionOf(
	blocks: Node[],
	spec: { heading: string; occurrence?: number | undefined },
): { start: number; end: number } | string {
	const asked = /^(#{1,6})\s+(.*)$/.exec(spec.heading.trim());
	const level = asked ? asked[1]!.length : null;
	const want = (asked ? asked[2]! : spec.heading).trim().toLowerCase();
	const found = blocks.flatMap((b, i) => {
		const l = levelOf(b);
		return l !== null && (level === null || l === level) && textOf(b).trim().toLowerCase() === want
			? [i]
			: [];
	});
	const headings = outline(blocks);
	if (found.length === 0)
		return `No heading "${spec.heading}"; the page's headings are ${headings.map((h) => JSON.stringify(h)).join(", ") || "none"}`;
	if (found.length > 1 && spec.occurrence === undefined)
		return `${found.length} headings say "${spec.heading}": give occurrence (1 to ${found.length}), or its level ("## …")`;
	const start = found[(spec.occurrence ?? 1) - 1];
	if (start === undefined) return `There are only ${found.length} headings "${spec.heading}"`;
	const own = levelOf(blocks[start]!)!;
	let end = start + 1;
	while (end < blocks.length && (levelOf(blocks[end]!) ?? Infinity) > own) end++;
	return { start, end };
}

/** Replaces `find` in the text of `nodes` (one text node at a time); how many it replaced. */
function replaceText(nodes: Node[], find: string, replace: string, all: boolean): number {
	let count = 0;
	const walk = (list: Node[]) => {
		for (const node of list) {
			if (
				(node.type === "text" || node.type === "code-highlight") &&
				typeof node.text === "string"
			) {
				const parts = node.text.split(find);
				if (parts.length > 1) {
					count += parts.length - 1;
					if (all || count === 1) node.text = parts.join(replace);
				}
			}
			if (Array.isArray(node.children)) walk(node.children);
		}
	};
	walk(nodes);
	return count;
}

/** Whether two blocks are lists of one kind, which read as one list side by side. */
const sameList = (a: Node | undefined, b: Node | undefined) =>
	a?.type === "list" && b?.type === "list" && a.listType === b.listType;

/**
 * `blocks.splice(start, remove, ...nodes)`, where a list put next to a list of
 * its kind joins it, as typing it in the editor would.
 */
function splice(blocks: Node[], start: number, remove: number, nodes: Node[]) {
	blocks.splice(start, remove, ...nodes);
	if (nodes.length === 0) return;
	const last = start + nodes.length - 1;
	if (sameList(blocks[last], blocks[last + 1])) {
		blocks[last] = {
			...blocks[last]!,
			children: [...blocks[last]!.children!, ...blocks[last + 1]!.children!],
		};
		blocks.splice(last + 1, 1);
	}
	if (start > 0 && sameList(blocks[start - 1], blocks[start])) {
		blocks[start - 1] = {
			...blocks[start - 1]!,
			children: [...blocks[start - 1]!.children!, ...blocks[start]!.children!],
		};
		blocks.splice(start, 1);
	}
}

/** One edit, made to `blocks` in place. */
function apply(blocks: Node[], edit: PageEdit): string | null {
	if (edit.action === "replace_text") {
		if (!edit.find) return "replace_text needs something to find";
		// Counted first, so a find that matches more than once without `all` changes nothing.
		const count = replaceText(structuredClone(blocks), edit.find, edit.replace, true);
		if (count === 0)
			return `"${edit.find}" isn't in the page's text (it's matched within one run of formatting)`;
		if (count > 1 && !edit.all)
			return `"${edit.find}" is in the page ${count} times: set all, or find something longer`;
		replaceText(blocks, edit.find, edit.replace, edit.all === true);
		return null;
	}
	const at = sectionOf(blocks, edit);
	if (typeof at === "string") return at;
	const nodes = "markdown" in edit ? markdownBlocks(edit.markdown) : [];
	switch (edit.action) {
		case "replace_section":
			splice(blocks, at.start + 1, at.end - at.start - 1, nodes);
			break;
		case "append_to_section":
			splice(blocks, at.end, 0, nodes);
			break;
		case "insert_before":
			splice(blocks, at.start, 0, nodes);
			break;
		case "insert_after":
			splice(blocks, at.start + 1, 0, nodes);
			break;
		case "delete_section":
			blocks.splice(at.start, at.end - at.start);
			break;
	}
	return null;
}

/**
 * Marks the one place `quote` is in the page's text for comment thread `id`,
 * as selecting it and commenting in the editor does. It has to be within one
 * run of formatting, outside code, and there only once.
 */
export function markQuote(blocks: Node[], quote: string, id: string): string | null {
	const found: { list: Node[]; index: number; at: number }[] = [];
	const walk = (list: Node[], inCode: boolean) => {
		for (const [index, node] of list.entries()) {
			if (node.type === "text" && !inCode && typeof node.text === "string")
				for (let at = node.text.indexOf(quote); at >= 0; at = node.text.indexOf(quote, at + 1))
					found.push({ list, index, at });
			if (Array.isArray(node.children)) walk(node.children, inCode || node.type === "code");
		}
	};
	walk(blocks, false);
	if (found.length === 0)
		return `"${quote}" isn't in the page's text (outside code, within one run of formatting)`;
	if (found.length > 1) return `"${quote}" is in the page ${found.length} times: quote more of it`;
	const { list, index, at } = found[0]!;
	const node = list[index]!;
	const text = node.text!;
	const piece = (part: string): Node => ({ ...node, text: part });
	list.splice(
		index,
		1,
		...(at > 0 ? [piece(text.slice(0, at))] : []),
		{
			type: "mark",
			version: 1,
			ids: [id],
			direction: null,
			format: "",
			indent: 0,
			children: [piece(quote)],
		},
		...(at + quote.length < text.length ? [piece(text.slice(at + quote.length))] : []),
	);
	return null;
}

/** Makes `edits` to page `id`'s content, in order, and saves it once. */
export const editPage = Effect.fn("Sections.editPage")(function* (id: string, input: unknown) {
	const edits = yield* Schema.decodeUnknownEffect(Schema.Array(PageEdit))(input);
	const page = yield* livePage(id, "edit");
	if (page.kind === "database") return yield* bad("A database has rows, not content");
	if (edits.length === 0) return yield* bad("No edits");
	const state = (parseJson(page.content) ?? fromMarkdown("")) as { root: Node };
	const blocks = [...(state.root.children ?? [])];
	for (const [i, edit] of edits.entries()) {
		const problem = apply(blocks, edit);
		if (problem)
			return yield* bad(
				`Edit ${i + 1} of ${edits.length} (${edit.action}): ${problem}. Nothing was changed.`,
			);
	}
	// An empty page still has its paragraph to type in.
	const children = blocks.length > 0 ? blocks : (fromMarkdown("").root.children as Node[]);
	yield* saveDoc(id, { ...state, root: { ...state.root, children } });
});
