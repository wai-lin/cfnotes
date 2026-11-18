import { $createCodeHighlightNode, $isCodeNode } from "@lexical/code";
import { registerCodeHighlighting, type Tokenizer } from "@lexical/code-shiki";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import {
	$createLineBreakNode,
	$createTabNode,
	$getNodeByKey,
	HISTORY_MERGE_TAG,
	tokenizeRawText,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import { createHighlighterCoreSync, stringifyTokenStyle, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguagesInfo } from "shiki/langs";

import { PLAIN_TEXT, resolveLanguage } from "./languages";

const THEMES = { light: "github-light", dark: "github-dark" } as const;

let shiki: HighlighterCore | undefined;
const loading = new Map<string, Promise<void>>();

/** Created on first use; both themes are bundled, grammars are fetched on demand. */
function highlighter(): HighlighterCore {
	shiki ??= createHighlighterCoreSync({
		engine: createJavaScriptRegexEngine(),
		themes: [githubLight, githubDark],
		langs: [],
	});
	return shiki;
}

function loadLanguage(id: string): Promise<void> {
	let pending = loading.get(id);
	if (!pending) {
		const info = bundledLanguagesInfo.find((item) => item.id === id);
		pending = info
			? info.import().then((grammar) => highlighter().loadLanguageSync(grammar.default))
			: Promise.resolve();
		loading.set(id, pending);
	}
	return pending;
}

function $pushText(nodes: LexicalNode[], text: string, style: string) {
	tokenizeRawText(text, {
		linebreak: () => nodes.push($createLineBreakNode()),
		tab: () => nodes.push($createTabNode()),
		text: (part) => {
			const node = $createCodeHighlightNode(part);
			if (style) node.setStyle(style);
			nodes.push(node);
		},
	});
}

function $plain(code: string): LexicalNode[] {
	const nodes: LexicalNode[] = [];
	$pushText(nodes, code, "");
	return nodes;
}

/**
 * Shiki syntax highlighting for code blocks.
 *
 * Tokens carry both theme colours (`color` for light, `--shiki-dark` for dark) so
 * the stylesheet can follow the colour scheme; nothing theme-specific is saved.
 * Text in the theme's default colour gets no style, so it inherits the page colour.
 */
export function registerShikiHighlighting(editor: LexicalEditor): () => void {
	const tokenizer: Tokenizer = {
		defaultLanguage: PLAIN_TEXT,
		defaultTheme: "none",
		$tokenize(codeNode, language) {
			const code = codeNode.getTextContent();
			const id = resolveLanguage(language);
			if (!id) return $plain(code);

			const shiki = highlighter();
			if (!shiki.getLoadedLanguages().includes(id)) {
				const key = codeNode.getKey();
				void loadLanguage(id).then(() =>
					editor.update(
						() => {
							const node = $getNodeByKey(key);
							if ($isCodeNode(node)) node.markDirty();
						},
						{ tag: HISTORY_MERGE_TAG },
					),
				);
				// Leave the block as it is until the grammar arrives: plain text now would
				// flash the colours off and count as an edit of a freshly loaded page.
				return codeNode.getChildren();
			}

			const { tokens } = shiki.codeToTokens(code, { lang: id, themes: THEMES });
			const lightFg = shiki.getTheme(THEMES.light).fg.toLowerCase();
			const darkFg = shiki.getTheme(THEMES.dark).fg.toLowerCase();
			const nodes: LexicalNode[] = [];
			tokens.forEach((line, index) => {
				if (index > 0) nodes.push($createLineBreakNode());
				for (const token of line) {
					const style = token.htmlStyle ?? {};
					const isDefault =
						style.color?.toLowerCase() === lightFg &&
						style["--shiki-dark"]?.toLowerCase() === darkFg &&
						Object.keys(style).length === 2;
					$pushText(nodes, token.content, isDefault ? "" : stringifyTokenStyle(style));
				}
			});
			return nodes;
		},
	};
	return registerCodeHighlighting(editor, tokenizer);
}
