import { $createLinkNode } from "@lexical/link";
import { mergeRegister } from "@lexical/utils";
import { embedFor, isEmbeddable, parseLink } from "@modules/embeds";
import { icon } from "@modules/icons";
import type { Preview } from "@modules/unfurl";
import {
	$createParagraphNode,
	$createTextNode,
	$getNodeByKey,
	$getSelection,
	$isParagraphNode,
	$isRangeSelection,
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_EDITOR,
	createCommand,
	DecoratorNode,
	HISTORY_MERGE_TAG,
	PASTE_COMMAND,
	type DOMExportOutput,
	type EditorConfig,
	type LexicalEditor,
	type LexicalNode,
	type NodeKey,
	type SerializedLexicalNode,
	type Spread,
} from "lexical";

import { $insertBlocks, $selectedBlockKey, registerClickSelect } from "./block-ops";

/** `embed`: the page or player in a frame. `bookmark`: a card with its title and image. */
export type EmbedMode = "embed" | "bookmark";

export type SerializedEmbedNode = Spread<
	{ url: string; mode: EmbedMode; height: number | null; preview?: Preview | null },
	SerializedLexicalNode
>;

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 1600;

/** Same-origin fetch of a bookmark's title, description and image (see `/unfurl`). */
const previews = new Map<string, Promise<Preview | null>>();
function fetchPreview(url: string): Promise<Preview | null> {
	let pending = previews.get(url);
	if (!pending) {
		pending = fetch(`/unfurl?url=${encodeURIComponent(url)}`)
			.then((res) => (res.ok ? (res.json() as Promise<Preview>) : null))
			.catch(() => null);
		previews.set(url, pending);
	}
	return pending;
}

/**
 * A web link shown in the page: an embedded player or page (YouTube, Figma,
 * Google Maps…; resizable from its bottom edge) or a bookmark card. With no
 * link yet it shows a box to paste one into.
 */
export class EmbedNode extends DecoratorNode<null> {
	__url: string;
	__mode: EmbedMode;
	__height: number | null;
	__preview: Preview | null;

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
		preview: Preview | null = null,
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

	setPreview(preview: Preview | null): this {
		const writable = this.getWritable();
		writable.__preview = preview;
		return writable;
	}

	override exportJSON(): SerializedEmbedNode {
		return {
			...super.exportJSON(),
			url: this.__url,
			mode: this.__mode,
			height: this.__height,
			preview: this.__preview,
		};
	}

	/** Copying out to other apps: a plain link. */
	override exportDOM(): DOMExportOutput {
		const a = document.createElement("a");
		a.href = this.__url;
		a.textContent = this.__preview?.title || this.__url;
		const p = document.createElement("p");
		p.append(a);
		return { element: p };
	}

	override getTextContent(): string {
		return this.__url;
	}

	override createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
		const wrap = document.createElement("div");
		wrap.contentEditable = "false";
		build(wrap, this, editor);
		return wrap;
	}

	override updateDOM(prev: this, dom: HTMLElement, _config: EditorConfig): boolean {
		// A new link or kind of block is drawn afresh; a new height or preview in place.
		if (prev.__url !== this.__url || prev.__mode !== this.__mode) return true;
		if (prev.__preview !== this.__preview) return true;
		if (prev.__height !== this.__height) sizeFrame(dom, this);
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

/** Sets an embed frame's height: the saved one, else the player's shape or default. */
function sizeFrame(wrap: HTMLElement, node: EmbedNode): void {
	const frame = wrap.querySelector<HTMLElement>(".ne-embed-frame");
	if (!frame || !node.__url) return;
	const embed = embedFor(new URL(node.__url));
	if (node.__height) {
		frame.style.aspectRatio = "";
		frame.style.height = `${node.__height}px`;
	} else if (embed.aspect) {
		frame.style.height = "";
		frame.style.aspectRatio = String(embed.aspect);
	} else {
		frame.style.aspectRatio = "";
		frame.style.height = `${embed.height ?? 400}px`;
	}
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** Runs `fn` on this block's node inside an editor update. */
function withNode(
	editor: LexicalEditor,
	key: NodeKey,
	fn: (node: EmbedNode) => void,
	tag?: string,
) {
	editor.update(
		() => {
			const node = $getNodeByKey(key);
			if ($isEmbedNode(node)) fn(node);
		},
		tag ? { tag } : undefined,
	);
}

/** Fills an embed block's DOM for its current state. */
function build(wrap: HTMLElement, node: EmbedNode, editor: LexicalEditor): void {
	const key = node.getKey();
	const url = node.__url ? parseLink(node.__url) : null;

	// ---- no link yet: a box to paste one into ----
	if (!url) {
		wrap.className = "ne-embed is-empty";
		const form = el("form", "ne-embed-form");
		const glyph = el("span", "ne-embed-glyph");
		glyph.innerHTML = icon(node.__mode === "bookmark" ? "bookmark" : "world", 18);
		const input = el("input", "ne-embed-input");
		input.type = "text"; // our own check, so bare links like youtu.be/… work
		input.inputMode = "url";
		input.autocomplete = "off";
		input.placeholder =
			node.__mode === "bookmark"
				? "Paste a link to make a bookmark…"
				: "Paste a link to embed (YouTube, Figma, Google Maps…)";
		input.setAttribute("aria-label", "Link");
		const go = el(
			"button",
			"ne-embed-go",
			node.__mode === "bookmark" ? "Create bookmark" : "Embed link",
		);
		go.type = "submit";
		const error = el("span", "ne-embed-error");
		form.append(glyph, input, go, error);
		wrap.append(form);
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
			input.addEventListener(type, (event) => event.stopPropagation());
		input.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			// Escape with nothing typed: drop the empty block and keep writing.
			event.preventDefault();
			withNode(editor, key, (n) => {
				const p = $createParagraphNode();
				n.replace(p);
				p.selectStart();
			});
			editor.focus();
		});
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			const link = parseLink(input.value);
			if (!link) {
				error.textContent = "That doesn't look like a link.";
				return;
			}
			withNode(editor, key, (n) => {
				n.setURL(link.href);
				const next = n.getNextSibling() ?? n.insertAfter($createParagraphNode());
				next.selectStart();
			});
			editor.focus();
		});
		// Focus the box when the block first appears.
		requestAnimationFrame(() => {
			if (wrap.isConnected && wrap.dataset.focused !== "1") {
				wrap.dataset.focused = "1";
				input.focus();
			}
		});
		return;
	}

	const tools = el("div", "ne-embed-tools");
	const tool = (name: Parameters<typeof icon>[0], label: string, run: () => void) => {
		const button = el("button", "ne-embed-tool");
		button.type = "button";
		button.innerHTML = `${icon(name, 14)}<span>${label}</span>`;
		button.title = label;
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			run();
		});
		tools.append(button);
	};
	tool(
		node.__mode === "embed" ? "bookmark" : "world",
		node.__mode === "embed" ? "Bookmark" : "Embed",
		() => withNode(editor, key, (n) => n.setMode(n.__mode === "embed" ? "bookmark" : "embed")),
	);
	tool("externalLink", "Open", () => window.open(url.href, "_blank", "noopener"));

	// ---- bookmark card ----
	if (node.__mode === "bookmark") {
		wrap.className = "ne-embed ne-bookmark-block";
		const preview = node.__preview;
		const card = el("a", `ne-bookmark${preview ? "" : " is-loading"}`);
		card.href = url.href;
		card.target = "_blank";
		card.rel = "noopener noreferrer";
		const text = el("div", "ne-bm-text");
		text.append(el("div", "ne-bm-title", preview?.title || url.hostname.replace(/^www\./, "")));
		if (preview?.description) text.append(el("div", "ne-bm-desc", preview.description));
		const line = el("div", "ne-bm-url");
		if (preview?.icon) {
			const fav = el("img", "ne-bm-icon");
			fav.src = preview.icon;
			fav.alt = "";
			fav.referrerPolicy = "no-referrer";
			fav.addEventListener("error", () => fav.remove());
			line.append(fav);
		}
		line.append(el("span", "", url.href));
		text.append(line);
		card.append(text);
		if (preview?.image) {
			const pic = el("div", "ne-bm-image");
			const img = el("img", "");
			img.src = preview.image;
			img.alt = "";
			img.loading = "lazy";
			img.referrerPolicy = "no-referrer";
			img.addEventListener("error", () => pic.remove());
			pic.append(img);
			card.append(pic);
		}
		wrap.append(card, tools);
		if (!preview)
			void fetchPreview(url.href).then((found) => {
				if (found)
					withNode(
						editor,
						key,
						(n) => n.__url === url.href && n.setPreview(found),
						HISTORY_MERGE_TAG,
					);
				else card.classList.remove("is-loading");
			});
		return;
	}

	// ---- embedded frame ----
	const embed = embedFor(url);
	wrap.className = `ne-embed ne-embed-block${embed.known ? "" : " is-generic"}`;
	const frame = el("div", "ne-embed-frame");
	const iframe = el("iframe", "");
	iframe.src = embed.src;
	iframe.title = `${embed.provider} embed`;
	iframe.loading = "lazy";
	iframe.allowFullscreen = true;
	iframe.referrerPolicy = "strict-origin-when-cross-origin";
	iframe.setAttribute(
		"allow",
		"autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share",
	);
	iframe.setAttribute(
		"sandbox",
		"allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation",
	);
	frame.append(iframe);
	const handle = el("span", "ne-embed-handle");
	handle.setAttribute("aria-hidden", "true");
	frame.append(handle);
	const bar = el("div", "ne-embed-bar");
	const link = el("a", "ne-embed-link");
	link.href = url.href;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.textContent = url.href;
	bar.append(el("span", "ne-embed-provider", embed.provider), link);
	wrap.append(frame, bar, tools);
	sizeFrame(wrap, node);

	// Bottom-edge drag sets the height; saved once on release.
	handle.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		event.stopPropagation();
		handle.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const startHeight = frame.getBoundingClientRect().height;
		let height = startHeight;
		wrap.classList.add("is-resizing");
		const move = (ev: PointerEvent) => {
			height = Math.round(
				Math.min(Math.max(startHeight + ev.clientY - startY, MIN_HEIGHT), MAX_HEIGHT),
			);
			frame.style.aspectRatio = "";
			frame.style.height = `${height}px`;
		};
		const up = () => {
			wrap.classList.remove("is-resizing");
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
			if (height !== startHeight) withNode(editor, key, (n) => n.setHeight(height));
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
	});
}

/** Inserts an embed (or bookmark) block at the cursor, asking for its link. */
export const INSERT_EMBED_COMMAND = createCommand<EmbedMode>("INSERT_EMBED_COMMAND");

/**
 * Wires up embed blocks: the insert command, click-to-select, and the
 * "Embed / Bookmark / Keep as link" menu after pasting a lone link on an empty line.
 */
export function registerEmbeds(editor: LexicalEditor, host: HTMLElement): () => void {
	const menu = el("div", "paste-menu");
	menu.setAttribute("role", "menu");
	menu.hidden = true;
	menu.addEventListener("mousedown", (event) => event.preventDefault());
	document.body.append(menu);

	let pasted: { paragraph: NodeKey; url: string } | null = null;
	let active = 0;
	let buttons: HTMLButtonElement[] = [];
	const hide = () => {
		menu.hidden = true;
		pasted = null;
	};
	const choose = (mode: EmbedMode | null) => {
		const target = pasted;
		hide();
		if (!target || !mode) return;
		editor.update(() => {
			const paragraph = $getNodeByKey(target.paragraph);
			if (!$isParagraphNode(paragraph) || paragraph.getTextContent().trim() !== target.url) return;
			const node = $createEmbedNode(target.url, mode);
			paragraph.replace(node);
			const next = node.getNextSibling() ?? node.insertAfter($createParagraphNode());
			next.selectStart();
		});
	};
	const highlight = () => buttons.forEach((b, i) => b.classList.toggle("is-active", i === active));
	const show = (url: URL, paragraph: NodeKey) => {
		const options: [EmbedMode | null, string, Parameters<typeof icon>[0]][] = [
			[null, "Keep as link", "link"],
			["bookmark", "Bookmark", "bookmark"],
		];
		if (isEmbeddable(url))
			options.splice(1, 0, ["embed", `Embed ${embedFor(url).provider}`, "world"]);
		menu.replaceChildren(el("div", "paste-menu-title", "Paste as"));
		buttons = options.map(([mode, label, name]) => {
			const button = el("button", "paste-menu-item");
			button.type = "button";
			button.innerHTML = `${icon(name, 16)}<span></span>`;
			button.querySelector("span")!.textContent = label;
			button.addEventListener("click", () => choose(mode));
			menu.append(button);
			return button;
		});
		active = isEmbeddable(url) ? 1 : 0;
		highlight();
		pasted = { paragraph, url: url.href };
		const range = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0) : null;
		const rect =
			range?.getBoundingClientRect() ?? editor.getElementByKey(paragraph)?.getBoundingClientRect();
		if (!rect) return;
		menu.hidden = false;
		menu.style.left = `${Math.min(rect.left, innerWidth - 240) + scrollX}px`;
		menu.style.top = `${rect.bottom + scrollY + 6}px`;
	};

	// The menu answers keys while it's open; anything else closes it.
	const onKey = (event: KeyboardEvent) => {
		if (menu.hidden) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			event.stopPropagation();
			active = (active + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
			highlight();
		} else if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			buttons[active]?.click();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			hide();
		} else if (!["Shift", "Meta", "Control", "Alt"].includes(event.key)) hide();
	};
	document.addEventListener("keydown", onKey, true);
	const onPointer = (event: PointerEvent) => {
		if (!menu.hidden && !menu.contains(event.target as Node)) hide();
	};
	document.addEventListener("pointerdown", onPointer, true);

	return mergeRegister(
		editor.registerCommand(
			INSERT_EMBED_COMMAND,
			(mode) => {
				$insertBlocks([$createEmbedNode("", mode)], $selectedBlockKey());
				return true;
			},
			COMMAND_PRIORITY_EDITOR,
		),
		// A lone link pasted on an empty top-level line: insert it as a link, then offer the menu.
		editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
				const data = event.clipboardData;
				if (data.files.length > 0 || data.types.includes("application/x-lexical-editor"))
					return false;
				const text = data.getData("text/plain").trim();
				if (!/^https?:\/\/\S+$/i.test(text)) return false;
				const url = parseLink(text);
				const selection = $getSelection();
				if (!url || !$isRangeSelection(selection) || !selection.isCollapsed()) return false;
				const block = selection.anchor.getNode().getTopLevelElement();
				if (
					!$isParagraphNode(block) ||
					block.getTextContentSize() > 0 ||
					block.getParent() === null
				)
					return false;
				event.preventDefault();
				const link = $createLinkNode(url.href);
				link.append($createTextNode(url.href));
				block.append(link);
				link.selectEnd();
				const key = block.getKey();
				requestAnimationFrame(() => show(url, key));
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		),
		registerClickSelect(editor, host, ".ne-embed:not(.is-empty)", $isEmbedNode),
		() => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("pointerdown", onPointer, true);
			menu.remove();
		},
	);
}
