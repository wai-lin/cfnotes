import {
	$createNodeSelection,
	$getNodeByKey,
	$setSelection,
	DecoratorNode,
	SKIP_DOM_SELECTION_TAG,
	type DOMConversionMap,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { $lineAfter } from "../../shared/blocks";
import {
	createImageElement,
	exportImageElement,
	MAX_CAPTION,
	updateImageElement,
	type ImageData,
} from "./view";

export type SerializedImageNode = Spread<
	{ src: string; alt: string; width: number | null; caption?: string },
	SerializedLexicalNode
>;

/**
 * Image sources worth keeping from pasted HTML: web images, and paths the app
 * serves (set with `setLocalImageSource`), but not huge `data:` URIs.
 */
let isLocalSource = (_src: string) => false;
export const setLocalImageSource = (test: (src: string) => boolean) => void (isLocalSource = test);

function importableSrc(src: string | null): src is string {
	return !!src && (/^https?:\/\//i.test(src) || isLocalSource(src));
}

/** An uploaded image block: resizable from its corner handle, with an optional caption. */
export class ImageNode extends DecoratorNode<null> {
	__src: string;
	__alt: string;
	__width: number | null;
	__caption: string;

	static override getType(): string {
		return "image";
	}

	static override clone(node: ImageNode): ImageNode {
		return new ImageNode(node.__src, node.__alt, node.__width, node.__caption, node.__key);
	}

	static override importJSON(json: SerializedImageNode): ImageNode {
		return $createImageNode(json.src, json.alt, json.width, json.caption ?? "").updateFromJSON(
			json,
		);
	}

	/**
	 * Pasted `<figure>` / `<img>` (from the web, Notion, Docs…) becomes an image
	 * block; a figure's caption comes along. Images inside a line are lifted out
	 * by the image extension's transform.
	 */
	static override importDOM(): DOMConversionMap {
		const convert = (img: HTMLImageElement, caption: string) => ({
			node: $createImageNode(
				img.getAttribute("src") ?? "",
				img.alt,
				Number(img.getAttribute("width")) || null,
				caption,
			),
		});
		return {
			figure: (domNode: HTMLElement) => {
				const img = domNode.querySelector("img");
				if (!img || !importableSrc(img.getAttribute("src"))) return null;
				const caption = domNode.querySelector("figcaption")?.textContent?.trim() ?? "";
				// `after` drops the figure's own children (the img and the caption text).
				return { priority: 2, conversion: () => ({ ...convert(img, caption), after: () => [] }) };
			},
			img: (domNode: HTMLElement) => {
				const img = domNode as HTMLImageElement;
				if (!importableSrc(img.getAttribute("src"))) return null;
				return { priority: 1, conversion: () => convert(img, "") };
			},
		};
	}

	constructor(src: string, alt: string, width: number | null = null, caption = "", key?: NodeKey) {
		super(key);
		this.__src = src;
		this.__alt = alt;
		this.__width = width;
		this.__caption = caption;
	}

	setWidth(width: number | null): this {
		const writable = this.getWritable();
		writable.__width = width;
		return writable;
	}

	setCaption(caption: string): this {
		const writable = this.getWritable();
		writable.__caption = caption.slice(0, MAX_CAPTION);
		return writable;
	}

	#data(): ImageData {
		return { src: this.__src, alt: this.__alt, width: this.__width, caption: this.__caption };
	}

	override exportJSON(): SerializedImageNode {
		return { ...super.exportJSON(), ...this.#data() };
	}

	override exportDOM(): DOMExportOutput {
		return { element: exportImageElement(this.#data()) };
	}

	override createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
		const key = this.getKey();
		const $setCaption = (caption: string) => {
			const node = $getNodeByKey(key);
			if ($isImageNode(node) && node.__caption !== caption) node.setCaption(caption);
		};
		return createImageElement(this.#data(), {
			onResize: (width) =>
				editor.update(() => {
					const node = $getNodeByKey(key);
					if ($isImageNode(node)) node.setWidth(width);
				}),
			// While typing: save without touching the editor's selection (focus stays here).
			onCaption: (caption) =>
				editor.update(() => $setCaption(caption), { tag: SKIP_DOM_SELECTION_TAG }),
			/**
			 * Leaving with a key: save and move the selection in one update (updates are
			 * batched, so a separate tagged save would also skip this selection), then
			 * focus the editor once it has committed.
			 */
			onLeave: (caption, to) =>
				editor.update(
					() => {
						$setCaption(caption);
						const node = $getNodeByKey(key);
						if (!node) return;
						if (to === "image") {
							const selection = $createNodeSelection();
							selection.add(key);
							$setSelection(selection);
						} else $lineAfter(node).selectStart();
					},
					{ onUpdate: () => editor.focus() },
				),
		});
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		updateImageElement(dom, prevNode.#data(), this.#data());
		return false;
	}

	override isInline(): boolean {
		return false;
	}

	override decorate(): null {
		return null;
	}
}

export function $createImageNode(
	src: string,
	alt: string,
	width: number | null = null,
	caption = "",
): ImageNode {
	return new ImageNode(src, alt, width, caption);
}

export function $isImageNode(node: LexicalNode | null | undefined): node is ImageNode {
	return node instanceof ImageNode;
}
