import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import { $createTextNode, $getSelection, $isRangeSelection, $isTextNode } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { el } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import {
	$removeTrigger,
	createListboxView,
	registerTypeahead,
	type TriggerMatch,
} from "../../shared/typeahead/index.ts";
import { mentionEmail, mentionUrl, MENTION_TRIGGER, rankPeople, type Person } from "./logic.ts";

export { mentionEmail, type Person } from "./logic.ts";

export interface MentionOptions {
	/** Who can be mentioned. */
	people: () => readonly Person[];
}

/**
 * `@` mentions: a picker of people, and a mention that's one piece (deleted
 * whole). It's a link to `mailto:<email>` reading `@name`, so Markdown keeps it
 * as `[@name](mailto:email)`. Needs the link extension.
 */
export function mentionExtension(options: MentionOptions): EditorExtension {
	return {
		name: "mention",
		register({ editor }) {
			const insert = (match: TriggerMatch, person: Person) => {
				editor.update(() => {
					$removeTrigger(match, MENTION_TRIGGER.prefix, true);
					const selection = $getSelection();
					if (!$isRangeSelection(selection)) return;
					const link = $createLinkNode(mentionUrl(person.email), { rel: "noreferrer" });
					link.append($createTextNode(`@${person.name}`).setMode("token"));
					const space = $createTextNode(" ");
					selection.insertNodes([link, space]);
					space.select(1, 1);
				});
				editor.focus();
			};

			let last: { json: string; people: Person[] } = { json: "", people: [] };
			const picker = registerTypeahead<Person>(editor, {
				trigger: MENTION_TRIGGER,
				items: (match) => {
					const found = rankPeople(options.people(), match.query);
					const json = JSON.stringify(found);
					if (json !== last.json) last = { json, people: found };
					return last.people;
				},
				choose: (person, match) => insert(match, person),
				view: (store) =>
					createListboxView<Person>({
						className: "slash-menu page-picker mention-picker",
						label: "Mention someone",
						heading: "Mention",
						renderItem: (button, person) => {
							button.classList.add("page-pick");
							button.innerHTML = icon("at");
							button.append(
								el("span", "slash-label", person.name),
								el("span", "slash-hint", person.email),
							);
						},
						onChoose: (index) => picker.choose(index),
						onHover: (index) => store.highlight(index),
					}),
			});

			return mergeRegister(
				picker.unregister,
				// A mention read back from Markdown is one piece again.
				editor.registerNodeTransform(LinkNode, (link) => {
					if (!$isLinkNode(link)) return;
					const only = link.getChildrenSize() === 1 ? link.getFirstChild() : null;
					if (!$isTextNode(only) || only.isToken()) return;
					if (mentionEmail(link.getURL(), only.getTextContent())) only.setMode("token");
				}),
			);
		},
	};
}
