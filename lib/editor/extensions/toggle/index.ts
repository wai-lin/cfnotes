import { mergeRegister } from "@lexical/utils";

import type { EditorExtension } from "../../core/extension";
import { listen } from "../../shared/dom";
import { $flipToggleAt, $insertToggle, registerToggleRepairs } from "./logic";
import { ToggleBodyNode, ToggleNode, ToggleTitleNode } from "./node";

export { $insertToggle } from "./logic";
export * from "./node";

/** How far into the title line the chevron's click zone goes. */
const CHEVRON_ZONE = 26;

/** Notion-style toggle lists: a title line that shows or hides the blocks under it. */
export function toggleExtension(): EditorExtension {
	return {
		name: "toggle",
		nodes: [ToggleNode, ToggleTitleNode, ToggleBodyNode],
		items: [
			{
				id: "toggle",
				label: "Toggle list",
				hint: "Hide and show content inside",
				keywords: "toggle collapse collapsible expand details",
				order: 80,
				hiddenIn: ["table"],
				turnInto: true,
				apply: () => $insertToggle(),
			},
		],
		register({ editor }) {
			const onClick = (event: MouseEvent) => {
				const root = editor.getRootElement();
				const title = (event.target as Element).closest<HTMLElement>(".ne-toggle-title");
				if (!title || !root?.contains(title)) return;
				// Only the chevron zone toggles; the rest of the line is for editing.
				if (event.clientX - title.getBoundingClientRect().left > CHEVRON_ZONE) return;
				event.preventDefault();
				editor.update(() => $flipToggleAt(title));
			};
			return mergeRegister(listen(document, "click", onClick), registerToggleRepairs(editor));
		},
	};
}
