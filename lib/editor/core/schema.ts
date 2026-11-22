import type { EditorThemeClasses } from "lexical";

import type { EditorExtension, EditorSchema } from "./extension.ts";

/** Gathers what `extensions` contribute, in the order the editor needs it. */
export function buildSchema(
	extensions: EditorExtension[],
	theme: EditorThemeClasses,
): EditorSchema {
	const names = new Set(extensions.map((extension) => extension.name));
	const all = <T>(pick: (extension: EditorExtension) => T[] | undefined) =>
		extensions.flatMap((extension) => pick(extension) ?? []);
	// `sort` is stable, so equal ranks and orders keep extension order.
	const transformers = all((e) => e.markdown)
		.sort((a, b) => b.rank - a.rank)
		.map((entry) => entry.transformer);
	return {
		theme,
		nodes: [...new Set(all((e) => e.nodes))],
		transformers,
		html: Object.assign({}, ...extensions.map((e) => e.html ?? {})),
		items: all((e) => e.items).sort((a, b) => a.order - b.order),
		containers: all((e) => e.containers),
		convertible: new Set(all((e) => e.convertible)),
		toolbar: all((e) => e.toolbar).sort((a, b) => a.order - b.order),
		has: (name) => names.has(name),
	};
}
