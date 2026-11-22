/**
 * A Notion-like block editor on Lexical, built from extensions.
 *
 *     import { mountEditor, notionLikeExtensions } from "./index.ts";
 *     const handle = mountEditor(host, {
 *       extensions: notionLikeExtensions({ upload }),
 *       state: saved,
 *       onChange: (json) => save(json),
 *     });
 *
 * See README.md for the layout and how to write an extension.
 */

// ---- core ----
export { mountEditor, type EditorHandle, type MountOptions } from "./core/mount.ts";
export {
	ranked,
	type BlockItem,
	type Container,
	type EditorExtension,
	type EditorSchema,
	type ExtensionContext,
	type RankedTransformer,
	type ToolbarItem,
} from "./core/extension.ts";
export { createStore, type Store } from "./core/store.ts";
export { theme } from "./core/theme.ts";
export { notionLikeExtensions, type NotionLikeOptions } from "./preset.ts";

// ---- shared ----
export { BACK_COLORS, TEXT_COLORS, type Palette } from "./shared/colors.ts";
export { IMAGE_TYPES, type Uploaded, type Uploader } from "./shared/upload.ts";

// ---- extensions ----
export { blockHandlesExtension } from "./extensions/block-handles/index.ts";
export { blockSelectExtension, type BlockSelectOptions } from "./extensions/block-select/index.ts";
export { calloutExtension } from "./extensions/callout/index.ts";
export { codeExtension, type CodeOptions } from "./extensions/code/index.ts";
export { columnsExtension } from "./extensions/columns/index.ts";
export {
	databaseExtension,
	INSERT_DATABASE_COMMAND,
	type DatabaseOptions,
} from "./extensions/database/index.ts";
export { dividerExtension } from "./extensions/divider/index.ts";
export {
	embedExtension,
	INSERT_EMBED_COMMAND,
	type LinkPreview,
	type PreviewFetcher,
} from "./extensions/embed/index.ts";
export { equationExtension, INSERT_EQUATION_COMMAND } from "./extensions/equation/index.ts";
export { fileExtension, INSERT_FILE_COMMAND } from "./extensions/file/index.ts";
export { formatToolbarExtension } from "./extensions/format-toolbar/index.ts";
export { globalUndoExtension } from "./extensions/global-undo/index.ts";
export { historyExtension } from "./extensions/history/index.ts";
export { imageExtension, INSERT_IMAGE_COMMAND } from "./extensions/image/index.ts";
export { linkExtension, OPEN_LINK_EDITOR_COMMAND } from "./extensions/link/index.ts";
export { listExtension } from "./extensions/list/index.ts";
export { markdownExtension } from "./extensions/markdown/index.ts";
export {
	pageLinkExtension,
	PAGE_LINK_TYPE,
	type PageDirectory,
	type PageEntry,
	type PageLinkOptions,
} from "./extensions/page-link/index.ts";
export { pagePickerExtension, type PagePickerOptions } from "./extensions/page-picker/index.ts";
export { pasteExtension } from "./extensions/paste/index.ts";
export { placeholderExtension, type PlaceholderOptions } from "./extensions/placeholder/index.ts";
export { richTextExtension } from "./extensions/rich-text/index.ts";
export { shortcutsExtension } from "./extensions/shortcuts/index.ts";
export { slashMenuExtension } from "./extensions/slash-menu/index.ts";
export { tableExtension } from "./extensions/table/index.ts";
export { toggleExtension } from "./extensions/toggle/index.ts";
export { trailingLineExtension } from "./extensions/trailing-line/index.ts";
