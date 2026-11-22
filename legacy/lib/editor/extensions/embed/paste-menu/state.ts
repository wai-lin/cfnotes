/** The "Paste as" menu after pasting a lone link on an empty line: what it offers. */
import type { NodeKey } from "lexical";

import { createStore } from "../../../core/store";
import type { IconName } from "../../../shared/icons";
import { embedFor, isEmbeddable } from "../providers";
import type { EmbedMode } from "../view";

export interface PasteOption {
	/** null keeps the link as it is. */
	mode: EmbedMode | null;
	label: string;
	icon: IconName;
}

export interface PasteMenuState {
	/** The line the link was pasted on, and the link; null while closed. */
	pasted: { paragraph: NodeKey; url: string } | null;
	options: PasteOption[];
	active: number;
}

export function createPasteMenuStore() {
	return createStore<PasteMenuState>({ pasted: null, options: [], active: 0 });
}

/** What a pasted link can become: kept as a link, embedded (when it can be), or a bookmark. */
export function pasteOptions(url: URL): { options: PasteOption[]; active: number } {
	const options: PasteOption[] = [
		{ mode: null, label: "Keep as link", icon: "link" },
		{ mode: "bookmark", label: "Bookmark", icon: "bookmark" },
	];
	if (!isEmbeddable(url)) return { options, active: 0 };
	options.splice(1, 0, { mode: "embed", label: `Embed ${embedFor(url).provider}`, icon: "world" });
	return { options, active: 1 };
}
