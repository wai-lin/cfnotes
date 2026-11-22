import type { BlockItem, EditorExtension } from "../../core/extension.ts";
import { $removeTrigger, registerTypeahead } from "../../shared/typeahead/index.ts";
import { filterItems, SLASH_TRIGGER } from "./logic.ts";
import { createSlashMenuView } from "./view.ts";

/**
 * Notion-style `/` command menu. It offers the block items every extension
 * contributes, minus those that can't go where the caret is.
 */
export function slashMenuExtension(): EditorExtension {
	return {
		name: "slash-menu",
		register({ editor, schema }) {
			const menu = registerTypeahead<BlockItem>(editor, {
				trigger: SLASH_TRIGGER,
				containers: schema.containers,
				items: (match) => filterItems(schema.items, match.query, match.containers),
				choose(item, match) {
					editor.update(() => {
						$removeTrigger(match, SLASH_TRIGGER.prefix);
						item.apply(editor);
					});
					editor.focus();
				},
				view: (store) =>
					createSlashMenuView({
						onChoose: (index) => menu.choose(index),
						onHover: (index) => store.highlight(index),
					}),
			});
			return menu.unregister;
		},
	};
}
