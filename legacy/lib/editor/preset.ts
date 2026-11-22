import type { EditorExtension } from "./core/extension";
import { blockHandlesExtension } from "./extensions/block-handles";
import { blockSelectExtension, type BlockSelectOptions } from "./extensions/block-select";
import { calloutExtension } from "./extensions/callout";
import { codeExtension, type CodeOptions } from "./extensions/code";
import { columnsExtension } from "./extensions/columns";
import { databaseExtension, type DatabaseOptions } from "./extensions/database";
import { dividerExtension } from "./extensions/divider";
import { embedExtension } from "./extensions/embed";
import type { PreviewFetcher } from "./extensions/embed/preview";
import { equationExtension } from "./extensions/equation";
import { fileExtension } from "./extensions/file";
import { formatToolbarExtension } from "./extensions/format-toolbar";
import { globalUndoExtension } from "./extensions/global-undo";
import { historyExtension } from "./extensions/history";
import { imageExtension } from "./extensions/image";
import { linkExtension } from "./extensions/link";
import { listExtension } from "./extensions/list";
import { markdownExtension } from "./extensions/markdown";
import { pageLinkExtension, type PageLinkOptions } from "./extensions/page-link";
import { pagePickerExtension } from "./extensions/page-picker";
import { pasteExtension } from "./extensions/paste";
import { placeholderExtension, type PlaceholderOptions } from "./extensions/placeholder";
import { richTextExtension } from "./extensions/rich-text";
import { shortcutsExtension } from "./extensions/shortcuts";
import { slashMenuExtension } from "./extensions/slash-menu";
import { tableExtension } from "./extensions/table";
import { toggleExtension } from "./extensions/toggle";
import { trailingLineExtension } from "./extensions/trailing-line";
import type { Uploader } from "./shared/upload";

export interface NotionLikeOptions {
	/** Stores uploaded images and files. */
	upload: Uploader;
	/** Image paths of the app's own that pasted HTML may keep. */
	localImageSource?: (src: string) => boolean;
	/** Links between pages and the `[[` picker; left out, there are none. */
	pages?: PageLinkOptions & { createPage?: (title: string) => Promise<string | null> };
	/** Inline databases; left out, there are none. */
	database?: DatabaseOptions;
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
		shortcutsExtension(),
		pasteExtension(),
		blockSelectExtension(options.blockSelect),
		columnsExtension(),
		equationExtension(),
		embedExtension({ fetchPreview: options.fetchPreview }),
		dividerExtension(),
		trailingLineExtension(),
		globalUndoExtension({ ignore: options.undoIgnore }),
	];
}
