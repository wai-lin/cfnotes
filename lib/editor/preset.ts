import type { EditorExtension } from "./core/extension.ts";
import { blockHandlesExtension } from "./extensions/block-handles/index.ts";
import { blockSelectExtension, type BlockSelectOptions } from "./extensions/block-select/index.ts";
import { calloutExtension } from "./extensions/callout/index.ts";
import { codeExtension, type CodeOptions } from "./extensions/code/index.ts";
import { columnsExtension } from "./extensions/columns/index.ts";
import { databaseExtension, type DatabaseOptions } from "./extensions/database/index.ts";
import { dividerExtension } from "./extensions/divider/index.ts";
import { embedExtension } from "./extensions/embed/index.ts";
import type { PreviewFetcher } from "./extensions/embed/preview.ts";
import { equationExtension } from "./extensions/equation/index.ts";
import { fileExtension } from "./extensions/file/index.ts";
import { formatToolbarExtension } from "./extensions/format-toolbar/index.ts";
import { globalUndoExtension } from "./extensions/global-undo/index.ts";
import { historyExtension } from "./extensions/history/index.ts";
import { imageExtension } from "./extensions/image/index.ts";
import { linkExtension } from "./extensions/link/index.ts";
import { listExtension } from "./extensions/list/index.ts";
import { markdownExtension } from "./extensions/markdown/index.ts";
import { mediaExtension } from "./extensions/media/index.ts";
import { pageLinkExtension, type PageLinkOptions } from "./extensions/page-link/index.ts";
import { pagePickerExtension } from "./extensions/page-picker/index.ts";
import { pasteExtension } from "./extensions/paste/index.ts";
import { placeholderExtension, type PlaceholderOptions } from "./extensions/placeholder/index.ts";
import { richTextExtension } from "./extensions/rich-text/index.ts";
import { shortcutsExtension } from "./extensions/shortcuts/index.ts";
import { slashMenuExtension } from "./extensions/slash-menu/index.ts";
import { syncedExtension, type SyncedStore } from "./extensions/synced/index.ts";
import { tableExtension } from "./extensions/table/index.ts";
import { tocExtension } from "./extensions/toc/index.ts";
import { toggleExtension } from "./extensions/toggle/index.ts";
import { trailingLineExtension } from "./extensions/trailing-line/index.ts";
import type { Uploader } from "./shared/upload.ts";

export interface NotionLikeOptions {
	/** Stores uploaded images and files. */
	upload: Uploader;
	/** Image paths of the app's own that pasted HTML may keep. */
	localImageSource?: (src: string) => boolean;
	/** Links between pages and the `[[` picker; left out, there are none. */
	pages?: PageLinkOptions & { createPage?: (title: string) => Promise<string | null> };
	/** Inline databases; left out, there are none. */
	database?: DatabaseOptions;
	/** Where synced blocks' content is kept; left out, there are none. */
	synced?: SyncedStore;
	/** Titles and images for bookmarks. */
	fetchPreview?: PreviewFetcher;
	code?: CodeOptions;
	placeholder?: PlaceholderOptions;
	blockSelect?: BlockSelectOptions;
	/** Where ⌘Z outside the editor belongs to something else (a selector). */
	undoIgnore?: string;
	/** History grouping, in ms. */
	historyDelay?: number;
}

/**
 * Every extension, for a Notion-like editor. The order matters where
 * extensions answer the same key at the same priority (the first registered
 * wins), so add your own at the end.
 */
export function notionLikeExtensions(options: NotionLikeOptions): EditorExtension[] {
	const { pages, database } = options;
	return [
		richTextExtension(),
		historyExtension({ delay: options.historyDelay }),
		listExtension(),
		markdownExtension(),
		slashMenuExtension(),
		placeholderExtension(options.placeholder),
		tableExtension(),
		codeExtension(options.code),
		...(pages ? [pageLinkExtension(pages)] : []),
		...(database ? [databaseExtension(database)] : []),
		...(pages
			? [pagePickerExtension({ directory: pages.directory, createPage: pages.createPage })]
			: []),
		blockHandlesExtension(),
		formatToolbarExtension(),
		linkExtension(),
		toggleExtension(),
		calloutExtension(),
		imageExtension({ upload: options.upload, localSource: options.localImageSource }),
		fileExtension({ upload: options.upload }),
		mediaExtension({ upload: options.upload }),
		shortcutsExtension(),
		pasteExtension(),
		blockSelectExtension(options.blockSelect),
		columnsExtension(),
		equationExtension(),
		embedExtension({ fetchPreview: options.fetchPreview }),
		tocExtension(),
		...(options.synced ? [syncedExtension({ store: options.synced })] : []),
		dividerExtension(),
		trailingLineExtension(),
		globalUndoExtension({ ignore: options.undoIgnore }),
	];
}
