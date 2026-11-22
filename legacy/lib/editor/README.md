# lib/editor

A Notion-like block editor on [Lexical](https://lexical.dev), built from
extensions. It knows nothing about cfnotes: the app passes in how files are
stored, what pages exist and how databases are made.

```ts
import { mountEditor, notionLikeExtensions } from "@lib/editor";

const handle = mountEditor(host, {
	extensions: notionLikeExtensions({ upload }),
	state: savedJson,
	onChange: (json) => save(json),
});
handle.focus();
handle.destroy();
```

`host` should be positioned: extensions put their overlays (block handles,
code bars, table controls) inside it. `app/client/notes/` is cfnotes' use of
it: the `<notes-editor>` element and the adapters it passes in.

## Layout

```txt
lib/editor/
├── index.ts          public API
├── preset.ts         notionLikeExtensions(): every extension, in order
├── core/             mounting, the extension contract, the store, the theme
├── shared/           helpers the extensions share
│   ├── blocks.ts     block operations ($insertBlocks, $selectedBlocks…)
│   ├── dom.ts        view helpers (el, placeFixed, listen…)
│   ├── typeahead/    menus opened by typing (`/`, `[[`)
│   └── …
└── extensions/       one folder per feature
    ├── table/
    │   ├── index.ts  the extension: wires the editor, the state and the view
    │   ├── logic.ts  document work ($ functions) and pure rules
    │   ├── state.ts  UI state (a store)
    │   └── view.ts   DOM: builds and redraws from the state
    └── …
```

## UI, state and logic

Each feature keeps three concerns apart:

- **Logic** (`logic.ts`, `node.ts`, pure files like `layout.ts`): what happens
  to the document. `$` functions run inside `editor.update`/`read`; pure
  functions (ranking, parsing, width math) have tests next to them.
- **State** (`state.ts`): what the UI shows: what's open, highlighted,
  hovered or dragged, in a `Store` (`core/store.ts`).
- **UI** (`view.ts`): DOM. A view builds its elements once, redraws in
  `render(state, prev)`, and reports what the reader does through callbacks.
  Views don't import Lexical.

`index.ts` connects them: editor events and commands update the state, the
store's `subscribe` calls the view's `render`, and the view's callbacks run
the logic. Small features with no UI of their own (shortcuts, placeholder)
are a single `index.ts`.

Node classes (`node.ts`) are Lexical's own rendering: their `createDOM` hands
the drawing to the view, and their callbacks do the editor updates.

## Writing an extension

```ts
import type { EditorExtension } from "@lib/editor";

export function wordCountExtension(): EditorExtension {
	return {
		name: "word-count",
		register({ editor, host }) {
			const badge = document.createElement("div");
			host.append(badge);
			const off = editor.registerTextContentListener((text) => {
				badge.textContent = `${text.split(/\s+/).filter(Boolean).length} words`;
			});
			return () => {
				off();
				badge.remove();
			};
		},
	};
}
```

An extension can also contribute:

| Field         | What                                                        |
| ------------- | ----------------------------------------------------------- |
| `nodes`       | node classes the document can hold                          |
| `markdown`    | markdown rules, ranked (`ranked(rank, ...transformers)`)    |
| `html`        | HTML import overrides for pasted HTML                       |
| `items`       | `/` menu entries; `turnInto` ones also go in the block menu |
| `containers`  | places that limit what goes in them (`hiddenIn` on items)   |
| `convertible` | node types the block menu can turn into others              |
| `toolbar`     | buttons on the selection toolbar                            |

Extensions don't import each other's internals. Where one needs another, it
goes through the schema (`schema.has("columns")`), a contribution (the slash
menu lists everyone's `items`) or a shared command (`shared/commands.ts`).

Order matters where two extensions answer the same key at the same priority:
the one registered first wins. `notionLikeExtensions` keeps a working order;
add your own after it.

## Adapters

What the app supplies, through extension options:

| Option                       | Used for                                       |
| ---------------------------- | ---------------------------------------------- |
| `upload(file)`               | images and attachments (`/image`, paste, drop) |
| `pages.directory`            | page link titles and the `[[` picker           |
| `pages.href`, `parseUrl`     | page addresses, pasting one as a link          |
| `pages.open`, `createPage`   | following a link, "New page" in the picker     |
| `database.create`, `element` | inline databases                               |
| `fetchPreview(url)`          | bookmark titles and images                     |

Failures are the app's to report: adapters return `null` and say why
themselves (the editor just doesn't insert anything).

## Styles

Each extension keeps its CSS next to its code (`extensions/table/styles.css`);
`styles.css` imports them all in cascade order. Import it at the top of the
page's stylesheet:

```css
@import "../../lib/editor/styles.css";
```

The rules theme themselves from the page's design tokens (`--text`, `--accent`,
`--border`…; the list is at the top of `styles.css`), so define those. Document
nodes use `ne-*` classes (see `core/theme.ts`); the controls use plain names
(`slash-menu`, `blk-handle`, `fmt-bar`…). Print styles stay with the page.
