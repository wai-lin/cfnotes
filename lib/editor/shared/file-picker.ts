import type { NodeKey } from "lexical";

import { el } from "./dom";

/** A hidden file input: `pick(at)` opens it, and the chosen files go to `onFiles`. */
export function createFilePicker(
	host: HTMLElement,
	className: string,
	accept: string | null,
	onFiles: (files: File[], at: NodeKey | null) => void,
): { pick: (at: NodeKey | null) => void; destroy: () => void } {
	const input = el("input", className);
	input.type = "file";
	if (accept) input.accept = accept;
	input.multiple = true;
	input.hidden = true;
	host.append(input);
	let at: NodeKey | null = null;
	input.addEventListener("change", () => {
		const files = [...(input.files ?? [])];
		input.value = "";
		onFiles(files, at);
	});
	return {
		pick(key) {
			at = key;
			input.click();
		},
		destroy: () => input.remove(),
	};
}
