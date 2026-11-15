import type { EditorThemeClasses } from "lexical";

/** CSS class names Lexical puts on the nodes it renders. Styled in site.css. */
export const theme: EditorThemeClasses = {
	paragraph: "ne-p",
	quote: "ne-quote",
	heading: { h1: "ne-h1", h2: "ne-h2", h3: "ne-h3" },
	list: {
		ul: "ne-ul",
		ol: "ne-ol",
		checklist: "ne-checklist",
		listitem: "ne-li",
		listitemChecked: "ne-li-checked",
		listitemUnchecked: "ne-li-unchecked",
		nested: { listitem: "ne-li-nested" },
	},
	code: "ne-code",
	table: "ne-table",
	tableScrollableWrapper: "ne-table-wrap",
	tableRow: "ne-tr",
	tableCell: "ne-td",
	tableCellHeader: "ne-th",
	tableCellSelected: "ne-cell-selected",
	tableSelection: "ne-table-selection",
	tableSelected: "ne-table-selected",
	link: "ne-link",
	text: {
		bold: "ne-bold",
		italic: "ne-italic",
		underline: "ne-underline",
		strikethrough: "ne-strike",
		underlineStrikethrough: "ne-underline-strike",
		code: "ne-inline-code",
		highlight: "ne-highlight",
	},
};
