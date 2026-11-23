import { el } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import type { MediaKind } from "../../shared/upload.ts";
import { formatSize } from "../file/format.ts";

/** Only our own paths (or https) are played; anything else would be a way in. */
const safeSrc = (src: string) => (/^(\/(?!\/)|https:\/\/)/.test(src) ? src : "");

/** A media block: the player (or PDF viewer), then the file's name, size and a download link. */
export function createMediaElement(file: {
	media: MediaKind;
	src: string;
	name: string;
	size: number;
}): HTMLElement {
	const figure = el("figure", `ne-media is-${file.media}`);
	figure.contentEditable = "false";
	const src = safeSrc(file.src);
	if (file.media === "pdf") {
		const frame = el("iframe", "ne-media-pdf");
		frame.src = src;
		frame.title = file.name || "PDF";
		frame.loading = "lazy";
		figure.append(frame);
	} else {
		const player = el(file.media, "ne-media-player");
		player.controls = true;
		player.preload = "metadata";
		player.src = src;
		if (player instanceof HTMLVideoElement) player.playsInline = true;
		figure.append(player);
	}
	const caption = el("figcaption", "ne-media-caption");
	const kind = el("span", "ne-media-icon");
	kind.innerHTML = icon(
		file.media === "audio" ? "music" : file.media === "pdf" ? "fileTypePdf" : "video",
		15,
	);
	const name = el("span", "ne-media-name", file.name || "Untitled");
	const size = el("span", "ne-media-size", formatSize(file.size));
	const open = el("a", "ne-media-link");
	open.href = src;
	open.target = "_blank";
	open.rel = "noopener";
	open.title = "Open in a new tab";
	open.setAttribute("aria-label", `Open ${file.name}`);
	open.innerHTML = icon("externalLink", 15);
	const download = el("a", "ne-media-link");
	download.href = src;
	download.download = file.name;
	download.title = "Download";
	download.setAttribute("aria-label", `Download ${file.name}`);
	download.innerHTML = icon("download", 15);
	caption.append(kind, name, size, open, download);
	figure.append(caption);
	return figure;
}
