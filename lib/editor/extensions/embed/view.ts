import { dragWith, el, isolateInput } from "../../shared/dom";
import { icon, type IconName } from "../../shared/icons";
import type { LinkPreview } from "./preview";
import { embedFor, parseLink } from "./providers";

/** `embed`: the page or player in a frame. `bookmark`: a card with its title and image. */
export type EmbedMode = "embed" | "bookmark";

export interface EmbedData {
	url: string;
	mode: EmbedMode;
	height: number | null;
	preview: LinkPreview | null;
}

export interface EmbedHandlers {
	/** A link was entered in the empty block. */
	onLink: (href: string) => void;
	/** Escape in the empty block: give up on it. */
	onDismiss: () => void;
	onToggleMode: () => void;
	/** The bottom-edge drag ended at a new height. */
	onResize: (height: number) => void;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 1600;

/** Sets an embed frame's height: the saved one, else the player's shape or default. */
export function sizeFrame(wrap: HTMLElement, data: EmbedData): void {
	const frame = wrap.querySelector<HTMLElement>(".ne-embed-frame");
	if (!frame || !data.url) return;
	const embed = embedFor(new URL(data.url));
	if (data.height) {
		frame.style.aspectRatio = "";
		frame.style.height = `${data.height}px`;
	} else if (embed.aspect) {
		frame.style.height = "";
		frame.style.aspectRatio = String(embed.aspect);
	} else {
		frame.style.aspectRatio = "";
		frame.style.height = `${embed.height ?? 400}px`;
	}
}

/** A bookmark whose preview couldn't be had stops looking like it's loading. */
export function stopLoading(wrap: HTMLElement): void {
	wrap.querySelector(".ne-bookmark")?.classList.remove("is-loading");
}

/** Fills an embed block's DOM for its state: a box for the link, a bookmark card, or a frame. */
export function buildEmbed(wrap: HTMLElement, data: EmbedData, handlers: EmbedHandlers): void {
	const url = data.url ? parseLink(data.url) : null;
	if (!url) return buildEmpty(wrap, data.mode, handlers);

	const tools = el("div", "ne-embed-tools");
	const tool = (name: IconName, label: string, run: () => void) => {
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
	const embedding = data.mode === "embed";
	tool(embedding ? "bookmark" : "world", embedding ? "Bookmark" : "Embed", handlers.onToggleMode);
	tool("externalLink", "Open", () => window.open(url.href, "_blank", "noopener"));

	if (data.mode === "bookmark") buildBookmark(wrap, url, data.preview);
	else buildFrame(wrap, url, data, handlers);
	wrap.append(tools);
}

// ---- no link yet: a box to paste one into ----
function buildEmpty(wrap: HTMLElement, mode: EmbedMode, handlers: EmbedHandlers): void {
	wrap.className = "ne-embed is-empty";
	const form = el("form", "ne-embed-form");
	const glyph = el("span", "ne-embed-glyph");
	glyph.innerHTML = icon(mode === "bookmark" ? "bookmark" : "world", 18);
	const input = el("input", "ne-embed-input");
	input.type = "text"; // our own check, so bare links like youtu.be/… work
	input.inputMode = "url";
	input.autocomplete = "off";
	input.placeholder =
		mode === "bookmark"
			? "Paste a link to make a bookmark…"
			: "Paste a link to embed (YouTube, Figma, Google Maps…)";
	input.setAttribute("aria-label", "Link");
	const go = el("button", "ne-embed-go", mode === "bookmark" ? "Create bookmark" : "Embed link");
	go.type = "submit";
	const error = el("span", "ne-embed-error");
	form.append(glyph, input, go, error);
	wrap.append(form);
	isolateInput(input);
	input.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		// Escape with nothing typed: drop the empty block and keep writing.
		event.preventDefault();
		handlers.onDismiss();
	});
	form.addEventListener("submit", (event) => {
		event.preventDefault();
		const link = parseLink(input.value);
		if (link) handlers.onLink(link.href);
		else error.textContent = "That doesn't look like a link.";
	});
	// Focus the box when the block first appears.
	requestAnimationFrame(() => {
		if (wrap.isConnected && wrap.dataset.focused !== "1") {
			wrap.dataset.focused = "1";
			input.focus();
		}
	});
}

// ---- bookmark card ----
function buildBookmark(wrap: HTMLElement, url: URL, preview: LinkPreview | null): void {
	wrap.className = "ne-embed ne-bookmark-block";
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
	wrap.append(card);
}

// ---- embedded frame ----
function buildFrame(wrap: HTMLElement, url: URL, data: EmbedData, handlers: EmbedHandlers): void {
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
	wrap.append(frame, bar);
	sizeFrame(wrap, data);

	// Bottom-edge drag sets the height; saved once on release.
	handle.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		event.stopPropagation();
		const startY = event.clientY;
		const startHeight = frame.getBoundingClientRect().height;
		let height = startHeight;
		wrap.classList.add("is-resizing");
		dragWith(
			handle,
			event,
			(ev) => {
				height = Math.round(
					Math.min(Math.max(startHeight + ev.clientY - startY, MIN_HEIGHT), MAX_HEIGHT),
				);
				frame.style.aspectRatio = "";
				frame.style.height = `${height}px`;
			},
			() => {
				wrap.classList.remove("is-resizing");
				if (height !== startHeight) handlers.onResize(height);
			},
		);
	});
}

/** Copying out to other apps: a plain link. */
export function exportEmbedElement(data: EmbedData): HTMLElement {
	const a = el("a");
	a.href = data.url;
	a.textContent = data.preview?.title || data.url;
	const p = el("p");
	p.append(a);
	return p;
}
