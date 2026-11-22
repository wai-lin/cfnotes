import { el } from "../../shared/dom.ts";
import { icon } from "../../shared/icons.ts";
import { formatSize } from "./format.ts";

/** An attachment row: paperclip, name, size and a download link. */
export function createFileElement(file: { src: string; name: string; size: number }): HTMLElement {
	const row = el("div", "ne-file");
	row.contentEditable = "false";
	const clip = el("span", "ne-file-icon");
	clip.innerHTML = icon("paperclip", 18);
	const name = el("span", "ne-file-name", file.name || "Untitled file");
	const size = el("span", "ne-file-size", formatSize(file.size));
	const link = el("a", "ne-file-dl");
	link.href = `${file.src}?name=${encodeURIComponent(file.name)}`;
	link.innerHTML = icon("download", 16);
	link.title = "Download";
	link.setAttribute("aria-label", `Download ${file.name}`);
	row.append(clip, name, size, link);
	return row;
}
