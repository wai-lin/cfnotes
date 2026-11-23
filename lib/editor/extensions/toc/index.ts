import { $isHeadingNode } from "@lexical/rich-text";
import { $dfs, mergeRegister } from "@lexical/utils";

import type { EditorExtension } from "../../core/extension.ts";
import { $insertBlocks, $selectedBlockKey } from "../../shared/blocks.ts";
import { registerClickSelect } from "../../shared/click-select.ts";
import { el, listen } from "../../shared/dom.ts";
import { indents, type TocEntry } from "./logic.ts";
import { $createTocNode, $isTocNode, TocNode } from "./node.ts";

export { $createTocNode, $isTocNode, TocNode } from "./node.ts";

/**
 * A table of contents block: the page's headings, linked. It follows the
 * headings as they change; clicking one scrolls to it.
 */
export function tocExtension(): EditorExtension {
	return {
		name: "toc",
		nodes: [TocNode],
		items: [
			{
				id: "toc",
				label: "Table of contents",
				hint: "Links to the page's headings",
				keywords: "table of contents toc outline headings index",
				order: 136,
				hiddenIn: ["table"],
				apply: () => $insertBlocks([$createTocNode()], $selectedBlockKey()),
			},
		],
		register({ editor, host }) {
			let last = "";
			const draw = () => {
				const { entries, hasToc } = editor.getEditorState().read(() => {
					const entries: TocEntry[] = [];
					let hasToc = false;
					for (const { node } of $dfs()) {
						if ($isTocNode(node)) hasToc = true;
						if (!$isHeadingNode(node)) continue;
						const level = Number(node.getTag().slice(1));
						const text = node.getTextContent().trim();
						if (text && level <= 3) entries.push({ key: node.getKey(), level, text });
					}
					return { entries, hasToc };
				});
				if (!hasToc) return;
				const blocks = [
					...(editor.getRootElement()?.querySelectorAll<HTMLElement>(".ne-toc") ?? []),
				];
				const signature = JSON.stringify(entries);
				// Redraw new blocks always, the rest only when the headings changed.
				const stale = blocks.filter((b) => signature !== last || !b.hasChildNodes());
				last = signature;
				const depth = indents(entries);
				for (const block of stale) {
					block.replaceChildren();
					if (entries.length === 0) {
						block.append(
							el("p", "ne-toc-empty", "Add headings to the page and they'll be listed here."),
						);
						continue;
					}
					entries.forEach((entry, i) => {
						const link = el("a", "ne-toc-item", entry.text);
						link.href = `#${entry.key}`;
						link.dataset.key = entry.key;
						link.style.setProperty("--toc-depth", String(depth[i]));
						block.append(link);
					});
				}
			};
			const onClick = (event: MouseEvent) => {
				const link = (event.target as Element).closest<HTMLAnchorElement>(".ne-toc-item");
				if (!link || !host.contains(link)) return;
				event.preventDefault();
				event.stopPropagation();
				const heading = editor.getElementByKey(link.dataset.key ?? "");
				if (!heading) return;
				heading.scrollIntoView({ behavior: "smooth", block: "start" });
				heading.classList.add("ne-toc-target");
				setTimeout(() => heading.classList.remove("ne-toc-target"), 1200);
			};
			draw();
			return mergeRegister(
				editor.registerUpdateListener(draw),
				listen(host, "click", onClick, true),
				registerClickSelect(editor, host, ".ne-toc", $isTocNode),
			);
		},
	};
}
