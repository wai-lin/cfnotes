/**
 * A Notion-like block editor on Lexical, built from extensions.
 *
 *     import { mountEditor, notionLikeExtensions } from "@lib/editor";
 *     const handle = mountEditor(host, {
 *       extensions: notionLikeExtensions({ upload }),
 *       state: saved,
 *       onChange: (json) => save(json),
 *     });
 *
 * See README.md for the layout and how to write an extension.
 */

// ---- core ----
export { mountEditor, type EditorHandle, type MountOptions } from "./core/mount";
export {
	ranked,
	type BlockItem,
	type Container,
	type EditorExtension,
	type EditorSchema,
	type ExtensionContext,
	type RankedTransformer,
	type ToolbarItem,
} from "./core/extension";
export { createStore, type Store } from "./core/store";
export { theme } from "./core/theme";
export { notionLikeExtensions, type NotionLikeOptions } from "./preset";

// ---- shared ----
export { BACK_COLORS, TEXT_COLORS, type Palette } from "./shared/colors";
export { IMAGE_TYPES, type Uploaded, type Uploader } from "./shared/upload";

// ---- extensions ----
export { blockHandlesExtension } from "./extensions/block-handles";
export { blockSelectExtension, type BlockSelectOptions } from "./extensions/block-select";
export { calloutExtension } from "./extensions/callout";
export { codeExtension, type CodeOptions } from "./extensions/code";
export { columnsExtension } from "./extensions/columns";
export {
	databaseExtension,
	INSERT_DATABASE_COMMAND,
	type DatabaseOptions,
} from "./extensions/database";
export { dividerExtension } from "./extensions/divider";
export {
	embedExtension,
	INSERT_EMBED_COMMAND,
	type LinkPreview,
	type PreviewFetcher,
} from "./extensions/embed";
export { equationExtension, INSERT_EQUATION_COMMAND } from "./extensions/equation";
export { fileExtension, INSERT_FILE_COMMAND } from "./extensions/file";
export { formatToolbarExtension } from "./extensions/format-toolbar";
export { globalUndoExtension } from "./extensions/global-undo";
export { historyExtension } from "./extensions/history";
export { imageExtension, INSERT_IMAGE_COMMAND } from "./extensions/image";
export { linkExtension, OPEN_LINK_EDITOR_COMMAND } from "./extensions/link";
export { listExtension } from "./extensions/list";
export { markdownExtension } from "./extensions/markdown";
export {
	pageLinkExtension,
	PAGE_LINK_TYPE,
	type PageDirectory,
	type PageEntry,
	type PageLinkOptions,
} from "./extensions/page-link";
export { pagePickerExtension, type PagePickerOptions } from "./extensions/page-picker";
export { pasteExtension } from "./extensions/paste";
export { placeholderExtension, type PlaceholderOptions } from "./extensions/placeholder";
export { richTextExtension } from "./extensions/rich-text";
export { shortcutsExtension } from "./extensions/shortcuts";
export { slashMenuExtension } from "./extensions/slash-menu";
export { tableExtension } from "./extensions/table";
export { toggleExtension } from "./extensions/toggle";
export { trailingLineExtension } from "./extensions/trailing-line";
