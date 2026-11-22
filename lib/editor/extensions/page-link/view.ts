import { icon } from "../../shared/icons.ts";

/** Draws a link from its page's current title, or as a deleted page (`title` null). */
export function paintPageLink(dom: HTMLElement, title: string | null, href: string): void {
	dom.classList.toggle("is-missing", title === null);
	const inner = document.createElement(title === null ? "span" : "a");
	inner.className = "ne-page-link-a";
	if (inner instanceof HTMLAnchorElement) inner.href = href;
	const label = document.createElement("span");
	label.className = "ne-page-link-title";
	label.textContent = title ?? "Deleted page";
	inner.innerHTML = icon(title === null ? "fileOff" : "fileText");
	inner.append(label);
	dom.replaceChildren(inner);
}
