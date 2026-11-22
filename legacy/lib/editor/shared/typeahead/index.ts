import { mergeRegister } from "@lexical/utils";
import {
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";

import { listen } from "../dom";
import { $findTrigger, type Trigger, type TriggerMatch } from "./logic";
import { createTypeaheadStore, type TypeaheadStore } from "./state";
import type { ListboxView } from "./view";

export { $findTrigger, $removeTrigger, type Trigger, type TriggerMatch } from "./logic";
export { createTypeaheadStore, type TypeaheadState, type TypeaheadStore } from "./state";
export { createListboxView, type ListboxOptions, type ListboxView } from "./view";

export interface TypeaheadOptions<T> {
	trigger: Trigger;
	containers?: { name: string; test: (node: LexicalNode) => boolean }[];
	/** The choices for a match; none closes the menu (unless `showEmpty`). */
	items: (match: TriggerMatch) => T[];
	showEmpty?: boolean;
	/** Called with the match the choice was made for (the menu is closed by then). */
	choose: (item: T, match: TriggerMatch) => void;
	view: (store: TypeaheadStore<T>) => ListboxView<T>;
}

/**
 * A menu opened by typing a trigger: it follows the text typed after it, and
 * ↑/↓, Enter/Tab and Escape drive it while it's open.
 */
export function registerTypeahead<T>(
	editor: LexicalEditor,
	options: TypeaheadOptions<T>,
): { store: TypeaheadStore<T>; choose(index: number): void; unregister: () => void } {
	const store = createTypeaheadStore<T>();
	const view = options.view(store);
	const offRender = store.subscribe((state, prev) => view.render(state, prev));

	const choose = (index: number) => {
		const { match, items } = store.get();
		const item = items[index];
		store.close();
		if (match && item !== undefined) options.choose(item, match);
	};

	const refresh = () => {
		const match = editor
			.getEditorState()
			.read(() => $findTrigger(options.trigger, options.containers));
		if (!match || store.isDismissed(match)) return store.close();
		const items = options.items(match);
		if (items.length === 0 && !options.showEmpty) return store.close();
		store.show(match, items);
	};

	const open = () => store.get().match !== null;
	const move = (delta: number) => (event: KeyboardEvent | null) => {
		if (!open() || store.get().items.length === 0) return false;
		event?.preventDefault();
		store.move(delta);
		return true;
	};
	const pick = (event: KeyboardEvent | null) => {
		const { match, items, active } = store.get();
		if (!match || items[active] === undefined) return false;
		event?.preventDefault();
		choose(active);
		return true;
	};
	const escape = (event: KeyboardEvent | null) => {
		if (!open()) return false;
		event?.preventDefault();
		store.dismiss();
		return true;
	};

	const unregister = mergeRegister(
		editor.registerUpdateListener(refresh),
		editor.registerCommand(KEY_ARROW_DOWN_COMMAND, move(1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ARROW_UP_COMMAND, move(-1), COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH),
		editor.registerCommand(KEY_ESCAPE_COMMAND, escape, COMMAND_PRIORITY_HIGH),
		listen(window, "scroll", () => open() && view.position(), true),
		offRender,
		() => view.destroy(),
	);
	return { store, choose, unregister };
}
