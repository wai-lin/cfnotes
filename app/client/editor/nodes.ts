import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { CHECK_LIST, TRANSFORMERS, type Transformer } from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";

import { CalloutNode } from "./callout-node";
import { ColumnNode, ColumnsNode } from "./columns-node";
import { DatabaseNode } from "./database-node";
import { DIVIDER_TRANSFORMER, DividerNode } from "./divider-node";
import { EmbedNode } from "./embed-node";
import {
	BLOCK_EQUATION_TRANSFORMER,
	EquationNode,
	INLINE_EQUATION_TRANSFORMER,
} from "./equation-node";
import { FileNode } from "./file-node";
import { ImageNode } from "./image-node";
import { PageLinkNode } from "./page-link-node";
import { ToggleBodyNode, ToggleNode, ToggleTitleNode } from "./toggle-node";

/** Every node type a page document can hold. */
export const EDITOR_NODES: Klass<LexicalNode>[] = [
	HeadingNode,
	QuoteNode,
	ListNode,
	ListItemNode,
	CodeNode,
	CodeHighlightNode,
	LinkNode,
	PageLinkNode,
	DatabaseNode,
	CalloutNode,
	ToggleNode,
	ToggleTitleNode,
	ToggleBodyNode,
	DividerNode,
	ImageNode,
	FileNode,
	TableNode,
	TableRowNode,
	TableCellNode,
	ColumnsNode,
	ColumnNode,
	EquationNode,
	EmbedNode,
];

/**
 * Markdown, for shortcuts while typing and for pasted markdown. The divider and
 * to-do rules come first so `---` and `- [ ]` aren't read as list items; the
 * equation rules come before the text formats so `$$x$$` isn't read as text.
 */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
	DIVIDER_TRANSFORMER,
	CHECK_LIST,
	BLOCK_EQUATION_TRANSFORMER,
	INLINE_EQUATION_TRANSFORMER,
	...TRANSFORMERS,
];
