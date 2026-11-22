import { $getSelection } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import {
	$removeTrigger,
	registerTypeahead,
	type TriggerMatch,
} from "../../shared/typeahead/index.ts";
import type { PageDirectory } from "../page-link/config.ts";
import { $insertPageLink } from "../page-link/logic.ts";
import { pickerChoices, PICKER_TRIGGER, type Choice } from "./logic.ts";
import { createPagePickerView } from "./view.ts";

export interface PagePickerOptions {
	directory: PageDirectory;
	/** Makes a page with this title; its id, or null when that failed (the app says why). */
	createPage?: (title: string) => Promise<string | null>;
}

/**
 * The `[[` page picker: search pages to link to, or make a new one from the
 * typed text. Needs the page-link extension.
 */
export function pagePickerExtension(options: PagePickerOptions): EditorExtension {
	return {
		name: "page-picker",
		items: [
			{
				id: "page-link",
				label: "Link to page",
				hint: "Link to another page",
				keywords: "link page mention reference",
				order: 210,
				// Types `[[`, which opens the picker.
				apply: () => $getSelection()?.insertText("[["),
			},
		],
		register({ editor }) {
			/** Removes the `[[query` text (if it's still there) and links to `pageId`. */
			const link = (match: TriggerMatch, pageId: string) => {
				editor.update(() => {
					$removeTrigger(match, PICKER_TRIGGER.prefix, true);
					$insertPageLink(pageId);
				});
				editor.focus();
			};

			let creating = false;
			const create = async (match: TriggerMatch, title: string) => {
				if (!options.createPage || creating) return;
				creating = true;
				try {
					const id = await options.createPage(title);
					if (id) link(match, id);
				} finally {
					creating = false;
				}
			};

			// The same choices give the same array, so the menu isn't rebuilt under the pointer.
			let last: { json: string; choices: Choice[] } = { json: "", choices: [] };
			const items = (match: TriggerMatch) => {
				const choices = pickerChoices(
					options.directory.pages(),
					match.query,
					options.directory.currentPageId(),
					!!options.createPage,
				);
				const json = JSON.stringify(choices);
				if (json !== last.json) last = { json, choices };
				return last.choices;
			};

			const picker = registerTypeahead<Choice>(editor, {
				trigger: PICKER_TRIGGER,
				items,
				showEmpty: true,
				choose(choice, match) {
					if (choice.kind === "page") link(match, choice.id);
					else void create(match, choice.title);
				},
				view: (store) =>
					createPagePickerView({
						onChoose: (index) => picker.choose(index),
						onHover: (index) => store.highlight(index),
					}),
			});
			return picker.unregister;
		},
	};
}
