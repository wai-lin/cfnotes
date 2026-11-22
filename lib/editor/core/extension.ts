import type { Transformer } from "@lexical/markdown";
import type {
	DOMConversionMap,
	EditorThemeClasses,
	Klass,
	LexicalEditor,
	LexicalNode,
} from "lexical";

import type { IconName } from "../shared/icons.ts";

/**
 * The editor is built from extensions. Each one brings its node types and
 * markdown rules, the items it adds to shared menus, and a `register` that
 * wires up its behaviour once the editor exists.
 */
export interface EditorExtension {
	name: string;
	/** Node classes the document can hold. */
	nodes?: Klass<LexicalNode>[];
	/** Markdown rules, for shortcuts while typing and for pasted markdown. */
	markdown?: RankedTransformer[];
	/** Editor-level HTML import overrides (for pasted HTML). */
	html?: DOMConversionMap;
	/** What the `/` menu offers (and, with `turnInto`, the block menu and ⌘⌥ shortcuts). */
	items?: BlockItem[];
	/** Places blocks can sit in that limit what goes inside them. */
	containers?: Container[];
	/** Node types (`getType()`) the block menu can turn into other blocks. */
	convertible?: string[];
	/** Buttons on the selection toolbar. */
	toolbar?: ToolbarItem[];
	/** Runs once the editor is mounted; returns its cleanup. */
	register?(context: ExtensionContext): (() => void) | void;
}

export interface ExtensionContext {
	editor: LexicalEditor;
	/** The element the editor is mounted in (positioned; overlays go inside it). */
	host: HTMLElement;
	schema: EditorSchema;
}

/** Everything the extensions contribute, gathered and ordered. */
export interface EditorSchema {
	theme: EditorThemeClasses;
	nodes: Klass<LexicalNode>[];
	transformers: Transformer[];
	html: DOMConversionMap;
	items: BlockItem[];
	containers: Container[];
	convertible: ReadonlySet<string>;
	toolbar: ToolbarItem[];
	/** Whether an extension of this name is part of the editor. */
	has(name: string): boolean;
}

/**
 * A markdown rule and its place in the list: higher ranks first, ties in
 * extension order. The order matters (`---` must be tried before list items).
 */
export interface RankedTransformer {
	rank: number;
	transformer: Transformer;
}

export const ranked = (rank: number, ...transformers: Transformer[]): RankedTransformer[] =>
	transformers.map((transformer) => ({ rank, transformer }));

/** A block type the `/` menu can insert. */
export interface BlockItem {
	/** Stable id (shortcuts and the block menu look items up by it). */
	id: string;
	label: string;
	hint: string;
	keywords: string;
	/** Position in the menu, lowest first. */
	order: number;
	/** Containers (by name) the item isn't offered in, e.g. tables don't nest. */
	hiddenIn?: string[];
	/** Offered in the block handle's "Turn into" menu. */
	turnInto?: boolean;
	/** Runs inside `editor.update`, after the `/query` text is removed. */
	apply: (editor: LexicalEditor) => void;
}

/** A kind of place (a table cell, a column) that some blocks can't go in. */
export interface Container {
	name: string;
	test: (node: LexicalNode) => boolean;
}

/** A button on the selection toolbar. */
export interface ToolbarItem {
	id: string;
	icon: IconName;
	label: string;
	/** Tooltip; defaults to the label. */
	title?: string;
	className?: string;
	order: number;
	run: (editor: LexicalEditor) => void;
	/** Lit while true. Called inside `editorState.read`, with a range selection. */
	isActive?: () => boolean;
}
