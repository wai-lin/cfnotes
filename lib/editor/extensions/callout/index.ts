import { mergeRegister } from "@lexical/utils";
import { $getNearestNodeFromDOMNode, $getNodeByKey, type NodeKey } from "lexical";

import type { EditorExtension } from "../../core/extension.ts";
import { createStore } from "../../core/store.ts";
import { setBlock } from "../../shared/blocks.ts";
import { listen, onPointerOutside } from "../../shared/dom.ts";
import { $createCalloutNode, $isCalloutNode, CalloutNode } from "./node.ts";
import { createEmojiPickerView } from "./view.ts";

export * from "./node.ts";

const EMOJI_CHOICES = ["💡", "📌", "✅", "⚠️", "❗", "🔥", "📝", "⭐", "💬", "🎯", "🚀", "❓"];
/** The emoji sits in the callout's left padding (its `::before`). */
const EMOJI_ZONE = 44;

/** Notion-style callouts: an emoji beside text on a tinted background; click the emoji to change it. */
export function calloutExtension({
	emoji = EMOJI_CHOICES,
}: { emoji?: string[] } = {}): EditorExtension {
	return {
		name: "callout",
		nodes: [CalloutNode],
		convertible: ["callout"],
		items: [
			{
				id: "callout",
				label: "Callout",
				hint: "Make writing stand out",
				keywords: "callout aside note info warning banner",
				order: 100,
				turnInto: true,
				apply: setBlock(() => $createCalloutNode()),
			},
		],
		register({ editor }) {
			const store = createStore<{ open: { key: NodeKey; at: DOMRect } | null }>({ open: null });
			const close = () => store.set({ open: null });

			const view = createEmojiPickerView(emoji, (choice) => {
				const key = store.get().open?.key;
				if (key)
					editor.update(() => {
						const node = $getNodeByKey(key);
						if ($isCalloutNode(node)) node.setEmoji(choice);
					});
				close();
			});
			const offRender = store.subscribe(({ open }) => view.render(open?.at ?? null));

			const onClick = (event: MouseEvent) => {
				const root = editor.getRootElement();
				const callout = (event.target as Element).closest<HTMLElement>(".ne-callout");
				if (!callout || !root?.contains(callout)) return;
				// Only clicks on the emoji itself.
				const rect = callout.getBoundingClientRect();
				if (event.clientX - rect.left > EMOJI_ZONE) return;
				event.preventDefault();
				const key = editor.read(() => {
					const node = $getNearestNodeFromDOMNode(callout);
					return $isCalloutNode(node) ? node.getKey() : null;
				});
				if (key)
					store.set({ open: { key, at: new DOMRect(rect.left + 10, rect.top + 8, 28, 28) } });
			};

			return mergeRegister(
				listen(document, "click", onClick),
				onPointerOutside(() => [view.element], close),
				offRender,
				() => view.destroy(),
			);
		},
	};
}
