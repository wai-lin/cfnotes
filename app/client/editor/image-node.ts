import { mergeRegister } from "@lexical/utils";
import {
	$createNodeSelection,
	$createParagraphNode,
	$getNodeByKey,
	$isParagraphNode,
	$setSelection,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
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

import { $insertBlocks, $selectedBlockKey, registerClickSelect } from "./block-ops";
import { IMAGE_TYPES, upload, type Uploaded } from "./uploads";

export type SerializedImageNode = Spread<
	{ src: string; alt: string; width: number | null; caption?: string },
	SerializedLexicalNode
>;

const MIN_WIDTH = 80;
const MAX_CAPTION = 500;

/** Image sources worth keeping from pasted HTML: our uploads and web images (not huge data: URIs). */
function importableSrc(src: string | null): src is string {
	return !!src && (/^https?:\/\//i.test(src) || src.startsWith("/files/img/"));
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
	 * by the transform in `registerImages`.
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

	override exportJSON(): SerializedImageNode {
		return {
			...super.exportJSON(),
			src: this.__src,
			alt: this.__alt,
			width: this.__width,
			caption: this.__caption,
		};
	}

	/** Copying out to other apps: a plain figure with an absolute image URL. */
	override exportDOM(): DOMExportOutput {
		const figure = document.createElement("figure");
		const img = document.createElement("img");
		img.src = new URL(this.__src, location.href).href;
		img.alt = this.__caption || this.__alt;
		if (this.__width) img.width = this.__width;
		figure.append(img);
		if (this.__caption) {
			const caption = document.createElement("figcaption");
			caption.textContent = this.__caption;
			figure.append(caption);
		}
		return { element: figure };
	}

	override createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
		const figure = document.createElement("figure");
		figure.className = `ne-image${this.__caption ? " has-caption" : ""}`;
		figure.contentEditable = "false";
		const frame = document.createElement("div");
		frame.className = "ne-image-frame";
		const img = document.createElement("img");
		img.src = this.__src;
		img.alt = this.__caption || this.__alt;
		img.draggable = false;
		if (this.__width) img.style.width = `${this.__width}px`;
		const handle = document.createElement("span");
		handle.className = "ne-image-handle";
		handle.setAttribute("aria-hidden", "true");
		frame.append(img, handle);

		const caption = document.createElement("input");
		caption.className = "ne-image-caption";
		caption.type = "text";
		caption.placeholder = "Add a caption…";
		caption.maxLength = MAX_CAPTION;
		caption.value = this.__caption;
		caption.setAttribute("aria-label", "Image caption");
		figure.append(frame, caption);

		const key = this.getKey();

		// Corner drag resizes; the width is saved once on release.
		handle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			handle.setPointerCapture(event.pointerId);
			const startX = event.clientX;
			const startWidth = img.getBoundingClientRect().width;
			const max = figure.parentElement?.getBoundingClientRect().width ?? startWidth;
			let width = startWidth;
			const move = (ev: PointerEvent) => {
				width = Math.round(Math.min(Math.max(startWidth + ev.clientX - startX, MIN_WIDTH), max));
				img.style.width = `${width}px`;
			};
			const up = () => {
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", up);
				if (width !== startWidth)
					editor.update(() => {
						const node = $getNodeByKey(key);
						if ($isImageNode(node)) node.setWidth(width);
					});
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up);
		});

		// The caption is a plain input: keep its keys and clipboard away from
		// Lexical, and save (without moving the editor's selection) as it changes.
		let timer: ReturnType<typeof setTimeout> | undefined;
		let leaving = false;
		const setCaption = () => {
			const node = $getNodeByKey(key);
			const value = caption.value.trim();
			if ($isImageNode(node) && node.__caption !== value) node.setCaption(value);
		};
		// While typing: save without touching the editor's selection (focus stays here).
		const save = () => {
			clearTimeout(timer);
			if (!leaving) editor.update(setCaption, { tag: SKIP_DOM_SELECTION_TAG });
		};
		/**
		 * Leaving with a key: save and move the selection in one update (updates are
		 * batched, so a separate tagged save would also skip this selection), then
		 * focus the editor once it has committed.
		 */
		const leave = (to: "below" | "image") => {
			clearTimeout(timer);
			leaving = true;
			caption.blur();
			leaving = false;
			editor.update(
				() => {
					setCaption();
					const node = $getNodeByKey(key);
					if (!node) return;
					if (to === "image") {
						const selection = $createNodeSelection();
						selection.add(key);
						$setSelection(selection);
					} else {
						const next = node.getNextSibling() ?? node.insertAfter($createParagraphNode());
						next.selectStart();
					}
				},
				{ onUpdate: () => editor.focus() },
			);
		};
		for (const type of [
			"keydown",
			"keypress",
			"keyup",
			"beforeinput",
			"input",
			"paste",
			"copy",
			"cut",
		])
			caption.addEventListener(type, (event) => event.stopPropagation());
		caption.addEventListener("input", () => {
			figure.classList.toggle("has-caption", caption.value.trim() !== "");
			clearTimeout(timer);
			timer = setTimeout(save, 400);
		});
		caption.addEventListener("blur", save);
		// Enter continues writing below the image; Escape selects the image itself.
		caption.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== "Escape") return;
			event.preventDefault();
			leave(event.key === "Enter" ? "below" : "image");
		});
		return figure;
	}

	override updateDOM(prevNode: this, dom: HTMLElement): boolean {
		const img = dom.querySelector("img");
		if (img && prevNode.__width !== this.__width)
			img.style.width = this.__width ? `${this.__width}px` : "";
		if (img && prevNode.__src !== this.__src) img.src = this.__src;
		if (prevNode.__caption !== this.__caption) {
			const caption = dom.querySelector<HTMLInputElement>(".ne-image-caption");
			// Undo/redo or a remote change; never clobber what's being typed.
			if (caption && document.activeElement !== caption) caption.value = this.__caption;
			dom.classList.toggle("has-caption", this.__caption !== "");
			if (img) img.alt = this.__caption || this.__alt;
		}
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

/** Opens the file picker and inserts the chosen images at the cursor. */
export const INSERT_IMAGE_COMMAND = createCommand<void>("INSERT_IMAGE_COMMAND");

export function registerImages(editor: LexicalEditor, host: HTMLElement): () => void {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = IMAGE_TYPES.join(",");
	input.multiple = true;
	input.hidden = true;
	input.className = "ne-image-input";
	host.append(input);

	const uploadAll = async (files: File[], blockKey: NodeKey | null) => {
		const images = (await Promise.all(files.map(upload))).filter(
			(x): x is Extract<Uploaded, { kind: "image" }> => x?.kind === "image",
		);
		if (images.length === 0) return;
		editor.update(() =>
			$insertBlocks(
				images.map((image) => $createImageNode(image.src, image.alt)),
				blockKey,
			),
		);
	};

	let pickAt: NodeKey | null = null;
	input.addEventListener("change", () => {
		const files = [...(input.files ?? [])].filter((f) => IMAGE_TYPES.includes(f.type));
		input.value = "";
		void uploadAll(files, pickAt);
	});

	return mergeRegister(
		editor.registerCommand(
			INSERT_IMAGE_COMMAND,
			() => {
				pickAt = $selectedBlockKey();
				input.click();
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		),
		// Clicking an image selects its block (so Backspace deletes it).
		registerClickSelect(editor, host, ".ne-image", $isImageNode),
		// An image is a block: one pasted inside a line splits the line around it.
		editor.registerNodeTransform(ImageNode, (node) => {
			const parent = node.getParent();
			if (!$isParagraphNode(parent)) return;
			const after = node.getNextSiblings();
			parent.insertAfter(node);
			if (after.length > 0) {
				const rest = $createParagraphNode();
				rest.append(...after);
				node.insertAfter(rest);
			}
			if (parent.isEmpty()) parent.remove();
		}),
		() => input.remove(),
	);
}
