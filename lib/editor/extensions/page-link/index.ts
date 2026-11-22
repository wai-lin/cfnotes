import { $isCodeNode } from "@lexical/code";
import { mergeRegister } from "@lexical/utils";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	COMMAND_PRIORITY_NORMAL,
	KEY_ARROW_LEFT_COMMAND,
	KEY_ARROW_RIGHT_COMMAND,
	PASTE_COMMAND,
} from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { listen } from "../../shared/dom.ts";
import { configurePageLinks, hrefOf, titleOf, type PageDirectory } from "./config.ts";
import { $hopOverPageLink, $insertPageLink } from "./logic.ts";
import { PageLinkNode } from "./node.ts";
import { paintPageLink } from "./view.ts";

export { type PageDirectory, type PageEntry } from "./config.ts";
export { $insertPageLink } from "./logic.ts";
export { $createPageLinkNode, $isPageLinkNode, PageLinkNode } from "./node.ts";
export { PAGE_LINK_TYPE } from "./type.ts";

export interface PageLinkOptions {
	directory: PageDirectory;
	/** The address of a page. */
	href: (id: string) => string;
	/** The page id in pasted text, if it's a link to one of the app's pages. */
	parseUrl?: (text: string) => string | null;
	/** Follows a link (plain click). Defaults to `location.assign`. */
	open?: (href: string) => void;
}

/**
 * Inline links to other pages. Clicking one opens the page (⌘/middle-click in
 * a new tab), pasting a page's address makes one, and links redraw when pages
 * are renamed or deleted.
 */
export function pageLinkExtension(options: PageLinkOptions): EditorExtension {
	const open = options.open ?? ((href: string) => location.assign(href));
	return {
		name: "page-link",
		nodes: [PageLinkNode],
		register({ editor, host }) {
			configurePageLinks({ directory: options.directory, href: options.href });

			const onClick = (event: MouseEvent) => {
				const link = (event.target as Element).closest<HTMLAnchorElement>(".ne-page-link a[href]");
				if (!link || !host.contains(link)) return;
				event.preventDefault();
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1)
					window.open(link.href, "_blank", "noopener");
				else open(link.href);
			};

			const repaint = () => {
				for (const dom of host.querySelectorAll<HTMLElement>(".ne-page-link[data-page-id]")) {
					const id = dom.dataset.pageId!;
					paintPageLink(dom, titleOf(id), hrefOf(id));
				}
			};

			const hop = (backward: boolean) => (event: KeyboardEvent) => {
				if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
				if (!$hopOverPageLink(backward)) return false;
				event.preventDefault();
				return true;
			};

			return mergeRegister(
				options.directory.subscribe(repaint),
				editor.registerCommand(KEY_ARROW_LEFT_COMMAND, hop(true), COMMAND_PRIORITY_LOW),
				editor.registerCommand(KEY_ARROW_RIGHT_COMMAND, hop(false), COMMAND_PRIORITY_LOW),
				editor.registerCommand(
					PASTE_COMMAND,
					(event) => {
						if (!options.parseUrl) return false;
						if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
						// Copies from another page carry Lexical's own format; let that paste as-is.
						if (event.clipboardData.types.includes("application/x-lexical-editor")) return false;
						const pageId = options.parseUrl(event.clipboardData.getData("text/plain"));
						if (!pageId || pageId === options.directory.currentPageId()) return false;
						const selection = $getSelection();
						if (!$isRangeSelection(selection)) return false;
						if ($isCodeNode(selection.anchor.getNode().getTopLevelElement())) return false;
						event.preventDefault();
						$insertPageLink(pageId);
						return true;
					},
					COMMAND_PRIORITY_NORMAL,
				),
				listen(host, "click", onClick),
				listen(host, "auxclick", onClick),
			);
		},
	};
}
