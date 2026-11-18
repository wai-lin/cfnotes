import {
	$createParagraphNode,
	$getNodeByKey,
	DecoratorNode,
	HISTORY_MERGE_TAG,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { $lineAfter } from "../../shared/blocks";
import { fetchPreview, type LinkPreview } from "./preview";
import {
	buildEmbed,
	exportEmbedElement,
	sizeFrame,
	stopLoading,
	type EmbedData,
	type EmbedMode,
} from "./view";

export type { EmbedMode } from "./view";

export type SerializedEmbedNode = Spread<
	{ url: string; mode: EmbedMode; height: number | null; preview?: LinkPreview | null },
	SerializedLexicalNode
>;

/**
 * A web link shown in the page: an embedded player or page (YouTube, Figma,
 * Google Maps…; resizable from its bottom edge) or a bookmark card. With no
 * link yet it shows a box to paste one into.
 */
export class EmbedNode extends DecoratorNode<null> {
	__url: string;
	__mode: EmbedMode;
	__height: number | null;
	__preview: LinkPreview | null;

	static override getType(): string {
		return "embed";
	}

	static override clone(node: EmbedNode): EmbedNode {
		return new EmbedNode(node.__url, node.__mode, node.__height, node.__preview, node.__key);
	}

	static override importJSON(json: SerializedEmbedNode): EmbedNode {
		return new EmbedNode(json.url, json.mode, json.height, json.preview ?? null).updateFromJSON(
			json,
		);
	}

	constructor(
		url = "",
		mode: EmbedMode = "embed",
		height: number | null = null,
		preview: LinkPreview | null = null,
		key?: NodeKey,
	) {
		super(key);
		this.__url = url;
		this.__mode = mode === "bookmark" ? "bookmark" : "embed";
		this.__height = height;
		this.__preview = preview;
	}

	getURL(): string {
		return this.__url;
	}

	setURL(url: string): this {
		const writable = this.getWritable();
		writable.__url = url;
		writable.__preview = null;
		writable.__height = null;
		return writable;
	}

	setMode(mode: EmbedMode): this {
		const writable = this.getWritable();
		writable.__mode = mode;
		return writable;
	}

	setHeight(height: number | null): this {
		const writable = this.getWritable();
		writable.__height = height;
		return writable;
	}

	setPreview(preview: LinkPreview | null): this {
		const writable = this.getWritable();
		writable.__preview = preview;
		return writable;
	}

	#data(): EmbedData {
		return { url: this.__url, mode: this.__mode, height: this.__height, preview: this.__preview };
	}

	override exportJSON(): SerializedEmbedNode {
		return { ...super.exportJSON(), ...this.#data() };
	}

	override exportDOM(): DOMExportOutput {
		return { element: exportEmbedElement(this.#data()) };
	}

	override getTextContent(): string {
		return this.__url;
	}

	override createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
		const wrap = document.createElement("div");
		wrap.contentEditable = "false";
		const key = this.getKey();
		const data = this.#data();
		/** Runs `fn` on this block's node inside an editor update. */
		const withNode = (fn: (node: EmbedNode) => void, tag?: string) =>
			editor.update(
				() => {
					const node = $getNodeByKey(key);
					if ($isEmbedNode(node)) fn(node);
				},
				tag ? { tag } : undefined,
			);

		buildEmbed(wrap, data, {
			onLink: (href) => {
				withNode((node) => {
					node.setURL(href);
					$lineAfter(node).selectStart();
				});
				editor.focus();
			},
			onDismiss: () => {
				withNode((node) => {
					const p = $createParagraphNode();
					node.replace(p);
					p.selectStart();
				});
				editor.focus();
			},
			onToggleMode: () =>
				withNode((node) => node.setMode(node.__mode === "embed" ? "bookmark" : "embed")),
			onResize: (height) => withNode((node) => node.setHeight(height)),
		});

		if (data.url && data.mode === "bookmark" && !data.preview)
			void fetchPreview(data.url).then((found) => {
				if (!found) return stopLoading(wrap);
				withNode((node) => {
					if (node.__url === data.url) node.setPreview(found);
				}, HISTORY_MERGE_TAG);
			});
		return wrap;
	}

	override updateDOM(prev: this, dom: HTMLElement, _config: EditorConfig): boolean {
		// A new link or kind of block is drawn afresh; a new height in place.
		if (prev.__url !== this.__url || prev.__mode !== this.__mode) return true;
		if (prev.__preview !== this.__preview) return true;
		if (prev.__height !== this.__height) sizeFrame(dom, this.#data());
		return false;
	}

	override isInline(): boolean {
		return false;
	}

	override decorate(): null {
		return null;
	}
}

export function $createEmbedNode(url = "", mode: EmbedMode = "embed"): EmbedNode {
	return new EmbedNode(url, mode);
}

export function $isEmbedNode(node: LexicalNode | null | undefined): node is EmbedNode {
	return node instanceof EmbedNode;
}
