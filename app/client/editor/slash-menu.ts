import { $createCodeNode, $isCodeNode } from "@lexical/code";
import {
	INSERT_CHECK_LIST_COMMAND,
	INSERT_ORDERED_LIST_COMMAND,
	INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createTableNodeWithDimensions, $isTableCellNode } from "@lexical/table";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
	$createParagraphNode,
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	type ElementNode,
	type LexicalEditor,
	type NodeKey,
} from "lexical";

import { $createCalloutNode } from "./callout-node";
import { $insertColumns, $isColumnNode } from "./columns-node";
import { INSERT_DATABASE_COMMAND } from "./database-node";
import { $createDividerNode } from "./divider-node";
import { INSERT_EMBED_COMMAND } from "./embed-node";
import { INSERT_EQUATION_COMMAND } from "./equation-node";
import { INSERT_FILE_COMMAND } from "./file-node";
import { INSERT_IMAGE_COMMAND } from "./image-node";
import { MERMAID_STARTER } from "./mermaid-preview";
import { $insertToggle } from "./toggle-node";

export interface SlashItem {
	label: string;
	hint: string;
	keywords: string;
	/** Hidden inside table cells (tables don't nest). */
	topLevelOnly?: boolean;
	/** Hidden inside columns (columns don't nest). */
	notInColumns?: boolean;
	/** Offered in the block handle's "Turn into" menu. */
	turnInto?: boolean;
	/** Runs inside `editor.update`, after the `/query` text is removed. */
	apply: (editor: LexicalEditor) => void;
}

function setBlock(create: () => ElementNode) {
	return () => {
		const selection = $getSelection();
		if ($isRangeSelection(selection)) $setBlocksType(selection, create);
	};
}

/** A 3×3 table with a header row, replacing the current line if it is empty. */
function $insertTable() {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block) return;
	const table = $createTableNodeWithDimensions(3, 3, { rows: true, columns: false });
	if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.replace(table);
	else block.insertAfter(table);
	// Leave somewhere to keep writing below the table.
	if (!table.getNextSibling()) table.insertAfter($createParagraphNode());
	table.getFirstDescendant()?.selectStart();
}

/** A divider after the current block, replacing it if it is an empty paragraph. */
function $insertDivider() {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block) return;
	const divider = $createDividerNode();
	if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.replace(divider);
	else block.insertAfter(divider);
	const next = divider.getNextSibling() ?? divider.insertAfter($createParagraphNode());
	next.selectStart();
}

/** A Mermaid code block with a starter diagram, replacing the line if it's empty. */
function $insertMermaid() {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return;
	const block = selection.anchor.getNode().getTopLevelElement();
	if (!block) return;
	const code = $createCodeNode("mermaid");
	code.append($createTextNode(MERMAID_STARTER));
	if ($isParagraphNode(block) && block.getTextContentSize() === 0) block.replace(code);
	else block.insertAfter(code);
	if (!code.getNextSibling()) code.insertAfter($createParagraphNode());
	code.selectEnd();
}

const ITEMS: SlashItem[] = [
	{
		label: "Text",
		hint: "Plain paragraph",
		keywords: "text paragraph plain",
		turnInto: true,
		apply: setBlock(() => $createParagraphNode()),
	},
	{
		label: "Heading 1",
		hint: "Big section heading",
		keywords: "h1 heading title",
		turnInto: true,
		apply: setBlock(() => $createHeadingNode("h1")),
	},
	{
		label: "Heading 2",
		hint: "Medium section heading",
		keywords: "h2 heading subtitle",
		turnInto: true,
		apply: setBlock(() => $createHeadingNode("h2")),
	},
	{
		label: "Heading 3",
		hint: "Small section heading",
		keywords: "h3 heading",
		turnInto: true,
		apply: setBlock(() => $createHeadingNode("h3")),
	},
	{
		label: "Bulleted list",
		hint: "Simple bulleted list",
		keywords: "ul bullet list unordered",
		turnInto: true,
		apply: (e) => e.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
	},
	{
		label: "Numbered list",
		hint: "List with numbering",
		keywords: "ol numbered list ordered",
		turnInto: true,
		apply: (e) => e.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
	},
	{
		label: "To-do list",
		hint: "Track tasks with checkboxes",
		keywords: "todo task check checkbox list",
		turnInto: true,
		apply: (e) => e.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
	},
	{
		label: "Toggle list",
		hint: "Hide and show content inside",
		keywords: "toggle collapse collapsible expand details",
		topLevelOnly: true,
		turnInto: true,
		apply: () => $insertToggle(),
	},
	{
		label: "Quote",
		hint: "Capture a quote",
		keywords: "quote blockquote citation",
		turnInto: true,
		apply: setBlock(() => $createQuoteNode()),
	},
	{
		label: "Callout",
		hint: "Make writing stand out",
		keywords: "callout aside note info warning banner",
		turnInto: true,
		apply: setBlock(() => $createCalloutNode()),
	},
	{
		label: "Image",
		hint: "Upload an image",
		keywords: "image picture photo upload file media",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_IMAGE_COMMAND, undefined),
	},
	{
		label: "File",
		hint: "Upload a file to download later",
		keywords: "file attachment upload pdf document attach",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_FILE_COMMAND, undefined),
	},
	{
		label: "Divider",
		hint: "Visually divide blocks",
		keywords: "divider hr rule line separator",
		topLevelOnly: true,
		apply: $insertDivider,
	},
	{
		label: "Code",
		hint: "Code block",
		keywords: "code snippet pre",
		turnInto: true,
		apply: setBlock(() => $createCodeNode()),
	},
	{
		label: "Mermaid diagram",
		hint: "Flowcharts, sequences, Gantt… from text",
		keywords: "mermaid diagram flowchart chart graph sequence gantt class state er mindmap",
		topLevelOnly: true,
		apply: $insertMermaid,
	},
	{
		label: "Block equation",
		hint: "Display a TeX equation",
		keywords: "equation math tex latex katex formula block",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: false }),
	},
	{
		label: "Inline equation",
		hint: "A TeX equation inside the line",
		keywords: "equation math tex latex katex formula inline",
		apply: (e) => e.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true }),
	},
	{
		label: "Embed",
		hint: "YouTube, Figma, Google Maps, any page…",
		keywords:
			"embed iframe video youtube vimeo loom figma maps spotify codepen sandbox google docs sheets slides drive miro",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_EMBED_COMMAND, "embed"),
	},
	{
		label: "Video",
		hint: "Embed from YouTube, Vimeo or Loom",
		keywords: "video youtube vimeo loom movie clip",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_EMBED_COMMAND, "embed"),
	},
	{
		label: "Web bookmark",
		hint: "A link as a visual card",
		keywords: "bookmark link card preview web url",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_EMBED_COMMAND, "bookmark"),
	},
	{
		label: "Link to page",
		hint: "Link to another page",
		keywords: "link page mention reference",
		// Types `[[`, which opens the page picker.
		apply: () => $getSelection()?.insertText("[["),
	},
	{
		label: "2 columns",
		hint: "Two blocks side by side",
		keywords: "columns column layout side split two 2",
		topLevelOnly: true,
		notInColumns: true,
		apply: () => $insertColumns(2),
	},
	{
		label: "3 columns",
		hint: "Three blocks side by side",
		keywords: "columns column layout side split three 3",
		topLevelOnly: true,
		notInColumns: true,
		apply: () => $insertColumns(3),
	},
	{
		label: "Table",
		hint: "Simple table with a header row",
		keywords: "table grid rows columns",
		topLevelOnly: true,
		apply: $insertTable,
	},
	{
		label: "Database",
		hint: "Table of pages with properties",
		keywords: "database table inline data rows properties",
		topLevelOnly: true,
		apply: (e) => e.dispatchCommand(INSERT_DATABASE_COMMAND, undefined),
	},
];

/** What a block can be turned into from the block handle's menu. */
export const TURN_INTO_ITEMS: SlashItem[] = ITEMS.filter((item) => item.turnInto);

interface Match {
	key: NodeKey;
	start: number;
	end: number;
	query: string;
	inTable: boolean;
	inColumn: boolean;
}

const TRIGGER = /(?:^|\s)\/([\w ]{0,24})$/;

/** Notion-style `/` command menu for a vanilla Lexical editor. */
export function registerSlashMenu(editor: LexicalEditor): () => void {
	const menu = document.createElement("div");
	menu.className = "slash-menu";
	menu.setAttribute("role", "listbox");
	menu.hidden = true;
	// Keep focus (and the selection) in the editor while clicking the menu.
	menu.addEventListener("mousedown", (event) => event.preventDefault());
	// Follow the pointer only when it really moves. When arrow keys scroll the menu,
	// items slide under a resting pointer and the browser fires hover events for them;
	// reacting to those would steal the keyboard highlight.
	let lastPointer = "";
	menu.addEventListener("pointermove", (event) => {
		const at = `${event.screenX},${event.screenY}`;
		if (at === lastPointer) return;
		lastPointer = at;
		const button = (event.target as Element).closest<HTMLElement>(".slash-item");
		const index = Number(button?.dataset.index ?? -1);
		if (index < 0 || index === active) return;
		active = index;
		highlight();
	});
	document.body.append(menu);

	let match: Match | null = null;
	let items: SlashItem[] = [];
	let active = 0;
	let dismissed: string | null = null;

	const close = () => {
		match = null;
		menu.hidden = true;
	};

	/** Moves the highlight without rebuilding, so a button under the pointer stays attached. */
	const highlight = () => {
		menu.querySelectorAll<HTMLElement>(".slash-item").forEach((button, index) => {
			button.classList.toggle("is-active", index === active);
			button.setAttribute("aria-selected", String(index === active));
		});
		menu.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
	};

	let rendered: SlashItem[] = [];
	const render = () => {
		if (rendered.length !== items.length || rendered.some((item, i) => item !== items[i])) {
			rendered = items;
			menu.replaceChildren(
				...items.map((item, index) => {
					const button = document.createElement("button");
					button.type = "button";
					button.className = "slash-item";
					button.setAttribute("role", "option");
					const label = document.createElement("span");
					label.className = "slash-label";
					label.textContent = item.label;
					const hint = document.createElement("span");
					hint.className = "slash-hint";
					hint.textContent = item.hint;
					button.append(label, hint);
					button.dataset.index = String(index);
					button.addEventListener("click", () => choose(item));
					return button;
				}),
			);
		}
		highlight();
	};

	const position = () => {
		const range = window.getSelection()?.getRangeAt(0);
		const rect = range?.getBoundingClientRect();
		if (!rect) return;
		const top = rect.bottom + 6;
		const fitsBelow = top + menu.offsetHeight < window.innerHeight;
		menu.style.top = `${fitsBelow ? top : Math.max(8, rect.top - menu.offsetHeight - 6)}px`;
		menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
	};

	const choose = (item: SlashItem) => {
		const current = match;
		close();
		if (!current) return;
		editor.update(() => {
			const node = $getNodeByKey(current.key);
			if ($isTextNode(node)) node.spliceText(current.start, current.end - current.start, "", true);
			item.apply(editor);
		});
		editor.focus();
	};

	const refresh = () => {
		let next: Match | null = null;
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
			const node = selection.anchor.getNode();
			if (!$isTextNode(node) || $isCodeNode(node.getTopLevelElement())) return;
			const before = node.getTextContent().slice(0, selection.anchor.offset);
			const found = TRIGGER.exec(before);
			if (!found) return;
			const query = found[1] ?? "";
			next = {
				key: node.getKey(),
				start: selection.anchor.offset - query.length - 1,
				end: selection.anchor.offset,
				query,
				inTable: $findMatchingParent(node, $isTableCellNode) !== null,
				inColumn: $findMatchingParent(node, $isColumnNode) !== null,
			};
		});

		const found = next as Match | null;
		if (!found || dismissed === `${found.key}:${found.start}`) return close();
		dismissed = null;

		const q = found.query.trim().toLowerCase();
		// Names starting with the query first, then names containing it, then keyword
		// matches (so `/link` puts "Link to page" above "Web bookmark"); otherwise in order.
		const rank = (item: SlashItem) => {
			const label = item.label.toLowerCase();
			return label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
		};
		const filtered = ITEMS.filter(
			(item) =>
				!(found.inTable && item.topLevelOnly) &&
				!(found.inColumn && item.notInColumns) &&
				(!q || item.label.toLowerCase().includes(q) || item.keywords.includes(q)),
		).sort((a, b) => (q ? rank(a) - rank(b) : 0));
		if (filtered.length === 0) return close();

		if (match?.query !== found.query) active = 0;
		match = found;
		items = filtered;
		active = Math.min(active, items.length - 1);
		menu.hidden = false;
		render();
		position();
	};

	const move = (delta: number) => (event: KeyboardEvent | null) => {
		if (!match) return false;
		event?.preventDefault();
		active = (active + delta + items.length) % items.length;
		render();
		return true;
	};

	const pick = (event: KeyboardEvent | null) => {
		if (!match) return false;
		const item = items[active];
		if (!item) return false;
		event?.preventDefault();
		choose(item);
		return true;
	};

	const onScroll = () => {
		if (match) position();
	};
	window.addEventListener("scroll", onScroll, true);

	return mergeRegister(
		editor.registerUpdateListener(refresh),
		editor.registerCommand(KEY_ARROW_DOWN_COMMAND, move(1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ARROW_UP_COMMAND, move(-1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			(event) => {
				if (!match) return false;
				event?.preventDefault();
				dismissed = `${match.key}:${match.start}`;
				close();
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		),
		() => {
			window.removeEventListener("scroll", onScroll, true);
			menu.remove();
		},
	);
}
