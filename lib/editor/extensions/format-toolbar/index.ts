import { mergeRegister } from "@lexical/utils";
import { COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND } from "lexical";

import type { EditorExtension } from "../../core/extension";
import { BACK_COLORS, TEXT_COLORS, type Palette } from "../../shared/colors";
import { listen } from "../../shared/dom";
import { $styleSelection, $toolbarFor, FORMAT_ITEMS } from "./logic";
import { createFormatToolbarStore, sameIds } from "./state";
import { createFormatToolbarView } from "./view";

export interface FormatToolbarOptions {
	textColors?: Palette;
	backColors?: Palette;
}

/**
 * A floating Notion-style toolbar over any text selection: B / i / U / S /
 * code, the buttons other extensions add (link, equation…), and colors.
 */
export function formatToolbarExtension(options: FormatToolbarOptions = {}): EditorExtension {
	return {
		name: "format-toolbar",
		toolbar: FORMAT_ITEMS,
		register({ editor, schema }) {
			const store = createFormatToolbarStore();
			const hide = () => store.set({ visible: false, colors: false });

			const view = createFormatToolbarView({
				items: schema.toolbar,
				textColors: options.textColors ?? TEXT_COLORS,
				backColors: options.backColors ?? BACK_COLORS,
				onItem: (item) => item.run(editor),
				onToggleColors: () => store.set({ colors: !store.get().colors }),
				onStyle: (styles) => {
					store.set({ colors: false });
					editor.update(() => $styleSelection(styles));
				},
				onLost: hide,
			});
			const offRender = store.subscribe((state, prev) => view.render(state, prev));

			const refresh = () => {
				const active = editor.getEditorState().read(() => $toolbarFor(schema.toolbar));
				if (!active) return hide();
				const previous = store.get();
				store.set({
					visible: true,
					active: sameIds(previous.active, active) ? previous.active : active,
				});
				// Already showing: the selection may have moved under it.
				if (previous.visible) view.place();
			};

			// Wait for mouseup so the bar doesn't chase a drag-selection.
			let dragging = false;
			const onBlur = (event: FocusEvent) => {
				const to = event.relatedTarget as Node | null;
				if (!to || !view.bar.contains(to)) hide();
			};
			const onScroll = () => store.get().visible && view.place();

			return mergeRegister(
				editor.registerCommand(
					SELECTION_CHANGE_COMMAND,
					() => {
						if (dragging) hide();
						else refresh();
						return false;
					},
					COMMAND_PRIORITY_LOW,
				),
				editor.registerUpdateListener(() => {
					if (!dragging) refresh();
				}),
				editor.registerRootListener((root, prevRoot) => {
					prevRoot?.removeEventListener("blur", onBlur);
					root?.addEventListener("blur", onBlur);
				}),
				listen(document, "mousedown", (event: MouseEvent) => {
					if (!view.bar.contains(event.target as Node)) dragging = true;
				}),
				listen(document, "mouseup", () => {
					dragging = false;
					setTimeout(refresh, 0);
				}),
				listen(window, "scroll", onScroll, true),
				listen(window, "resize", onScroll),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
