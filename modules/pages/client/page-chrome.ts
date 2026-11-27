/**
 * Page icon and cover controls: the "Add icon" / "Add cover" strip above the
 * title, the emoji picker on the icon, and the cover's change/remove actions.
 * Server state lives in the `icon` and `cover` page actions (`.page-head` data).
 */

import { icon, type IconName } from "#lib/icons.ts";
import { alertDialog } from "#lib/ui/dialog.ts";

import type { NotesEditorElement } from "./notes-editor.ts";

const EMOJI = [
	"😀",
	"😄",
	"😊",
	"😎",
	"🤔",
	"😴",
	"🥳",
	"🤩",
	"😍",
	"🤯",
	"👍",
	"👀",
	"💡",
	"🔥",
	"⭐",
	"✨",
	"🎉",
	"🎯",
	"🚀",
	"📌",
	"📄",
	"📝",
	"📚",
	"📦",
	"📷",
	"✅",
	"❗",
	"❓",
	"💰",
	"🏠",
	"🌈",
	"🍀",
	"🍕",
	"☕",
	"🎵",
	"🏆",
	"⚡",
	"🧠",
	"❤️",
	"🔔",
];
const GRADIENTS = ["g1", "g2", "g3", "g4", "g5", "g6"];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)] as T;

function post(path: string, body: Record<string, unknown>): Promise<Response> {
	return fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** A small fixed popover under `anchor`, closed by clicking anywhere outside. */
function popover(className: string, anchor: HTMLElement): HTMLElement {
	document.querySelector(".chrome-pop")?.remove();
	const pop = document.createElement("div");
	pop.className = `chrome-pop ${className}`;
	document.body.append(pop);
	const place = () => {
		const rect = anchor.getBoundingClientRect();
		pop.style.top = `${Math.min(rect.bottom + 6, innerHeight - pop.offsetHeight - 8)}px`;
		pop.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - pop.offsetWidth - 8))}px`;
	};
	const onOutside = (event: PointerEvent) => {
		if (pop.contains(event.target as Node) || anchor.contains(event.target as Node)) return;
		close();
	};
	const close = () => {
		pop.remove();
		document.removeEventListener("pointerdown", onOutside, true);
	};
	document.addEventListener("pointerdown", onOutside, true);
	pop.addEventListener("click", (event) => {
		if ((event.target as Element).closest("button")) close();
	});
	queueMicrotask(place);
	return pop;
}

function setup(head: HTMLElement): void {
	const article = document.querySelector<HTMLElement>("article.page");
	const cover = document.querySelector<HTMLElement>(".page-cover");
	const iconButton = head.querySelector<HTMLButtonElement>(".page-icon");
	if (!article || !cover || !iconButton) return;
	const { iconPath = "", coverPath = "", pageId = "" } = head.dataset;

	// ---- icon ----
	const applyIcon = async (value: string | null) => {
		iconButton.textContent = value ?? "";
		article.classList.toggle("has-icon", Boolean(value));
		try {
			const res = await post(iconPath, { icon: value ?? "" });
			const data = (await res.json()) as { nav?: string };
			// The sidebar link shows the emoji too; the server renders the patch.
			const link = document.getElementById(`nav-${pageId}`);
			if (data.nav && link) link.outerHTML = data.nav;
		} catch (error) {
			console.warn("[page-chrome] icon save failed", error);
		}
	};

	const openEmojiPicker = (anchor: HTMLElement) => {
		const pop = popover("icon-pick", anchor);
		const grid = document.createElement("div");
		grid.className = "icon-grid";
		for (const emoji of EMOJI) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "icon-choice";
			button.textContent = emoji;
			button.addEventListener("click", () => void applyIcon(emoji));
			grid.append(button);
		}
		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "icon-remove";
		remove.textContent = "Remove";
		remove.addEventListener("click", () => void applyIcon(null));
		pop.append(grid, remove);
	};

	head.querySelector(".page-add-icon")?.addEventListener("click", () => {
		void applyIcon(pick(EMOJI));
	});
	iconButton.addEventListener("click", () => openEmojiPicker(iconButton));

	// ---- cover ----
	const paintCover = (value: string | null) => {
		cover.classList.remove("is-empty", ...GRADIENTS.map((g) => `cover-${g}`));
		cover.style.backgroundImage = "";
		if (!value) cover.classList.add("is-empty");
		else if (value.startsWith("/files/"))
			cover.style.backgroundImage = `url(${JSON.stringify(value)})`;
		else cover.classList.add(`cover-${value}`);
		article.classList.toggle("has-cover", Boolean(value));
	};

	const applyCover = async (value: string | null) => {
		paintCover(value);
		try {
			await post(coverPath, { cover: value ?? "" });
		} catch (error) {
			console.warn("[page-chrome] cover save failed", error);
		}
	};

	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/png,image/jpeg,image/gif,image/webp";
	input.hidden = true;
	document.body.append(input);
	input.addEventListener("change", async () => {
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		const body = new FormData();
		body.append("file", file);
		try {
			const res = await fetch("/files", { method: "POST", body });
			if (!res.ok) throw new Error(`upload failed: ${res.status}`);
			const { key } = (await res.json()) as { key: string };
			await applyCover(`/files/${key}`);
		} catch (error) {
			console.warn("[page-chrome] cover upload failed", error);
			void alertDialog("Couldn't upload the cover image", "Check your connection and try again.");
		}
	});

	const openCoverPicker = (anchor: HTMLElement) => {
		const pop = popover("cover-pick", anchor);
		const row = document.createElement("div");
		row.className = "cover-grid";
		for (const gradient of GRADIENTS) {
			const swatch = document.createElement("button");
			swatch.type = "button";
			swatch.className = `cover-swatch cover-${gradient}`;
			swatch.setAttribute("aria-label", `Cover ${gradient}`);
			swatch.addEventListener("click", () => void applyCover(gradient));
			row.append(swatch);
		}
		const uploadButton = document.createElement("button");
		uploadButton.type = "button";
		uploadButton.className = "cover-upload";
		uploadButton.textContent = "Upload image";
		uploadButton.addEventListener("click", () => input.click());
		pop.append(row, uploadButton);
	};

	head.querySelector(".page-add-cover")?.addEventListener("click", () => {
		void applyCover(pick(GRADIENTS));
	});
	cover.querySelector(".cover-change")?.addEventListener("click", (event) => {
		openCoverPicker(event.currentTarget as HTMLElement);
	});
	cover.querySelector(".cover-remove")?.addEventListener("click", () => void applyCover(null));
}

const head = document.querySelector<HTMLElement>(".page-head");
if (head) setup(head);

/**
 * On a phone the page bar keeps its crumb and save status, and "More" holds
 * the rest: each entry clicks the button it stands for, hidden there.
 */
function moreMenu(more: HTMLElement): void {
	const bar = more.closest<HTMLElement>(".page-bar");
	if (!bar) return;
	more.addEventListener("click", () => {
		const shown = document.querySelector(".chrome-pop.page-menu");
		if (shown) return void shown.remove();
		const entries: { label: string; icon: IconName; run?: HTMLElement; danger?: boolean }[] = [];
		const locked = bar.querySelector<HTMLElement>(".page-locked");
		if (locked) entries.push({ label: locked.title || "Locked", icon: "lock" });
		const comments = bar.querySelector<HTMLElement>(".cm-toggle");
		if (comments) {
			const count = comments.querySelector(".cm-count")?.textContent;
			entries.push({
				label: count ? `Comments (${count})` : "Comments",
				icon: "messageCircle",
				run: comments,
			});
		}
		const share = bar.querySelector<HTMLElement>(".page-share");
		if (share) entries.push({ label: "Share", icon: "user", run: share });
		for (const form of bar.querySelectorAll<HTMLFormElement>("form")) {
			const button = form.querySelector<HTMLElement>("button[type=submit]");
			const label = button?.textContent?.trim() ?? "";
			if (!button || !label) continue;
			const isDelete = label === "Delete";
			entries.push({
				label,
				icon: isDelete ? "trash" : "lock",
				run: button,
				danger: isDelete,
			});
		}
		const exporter = bar.querySelector<HTMLElement>(".page-export");
		if (exporter) entries.push({ label: "Export PDF", icon: "download", run: exporter });
		// Delete last, as menus put it.
		entries.sort((a, b) => Number(a.danger ?? false) - Number(b.danger ?? false));

		const pop = popover("page-menu", more);
		pop.setAttribute("role", "menu");
		for (const entry of entries) {
			const item = document.createElement(entry.run ? "button" : "div");
			item.className = `db-menu-item${entry.danger ? " is-danger" : ""}${entry.run ? "" : " page-menu-note"}`;
			if (item instanceof HTMLButtonElement) {
				item.type = "button";
				item.setAttribute("role", "menuitem");
			}
			item.innerHTML = icon(entry.icon, 16);
			item.append(Object.assign(document.createElement("span"), { textContent: entry.label }));
			if (entry.run) {
				const target = entry.run;
				item.addEventListener("click", () => target.click());
			}
			pop.append(item);
		}
		pop.querySelector<HTMLElement>("button")?.focus();
	});
}

const more = document.querySelector<HTMLElement>(".page-bar .page-bar-more");
if (more) moreMenu(more);

/**
 * Export PDF: the browser's print dialog (choose "Save as PDF"), with the print
 * stylesheet in lib/ui/app.css laying out just the page. Saves pending edits first,
 * loads lazy images so they make it in, and names the file after the page.
 */
async function exportPdf(): Promise<void> {
	const editor = document.querySelector<NotesEditorElement>("notes-editor");
	await editor?.flush?.();
	(document.activeElement as HTMLElement | null)?.blur();
	const images = [...document.querySelectorAll<HTMLImageElement>("article.page img")];
	for (const img of images) img.loading = "eager";
	await Promise.race([
		Promise.all(images.filter((img) => !img.complete).map((img) => img.decode().catch(() => null))),
		new Promise((resolve) => setTimeout(resolve, 3000)),
	]);
	const title = document.querySelector<HTMLInputElement>(".page-title")?.value.trim() || "Untitled";
	const before = document.title;
	document.title = title; // the default file name
	addEventListener("afterprint", () => (document.title = before), { once: true });
	print();
}

document.querySelector(".page-export")?.addEventListener("click", () => void exportPdf());

// The title is an input, which can't wrap; on paper it's a heading (however printing starts).
addEventListener("beforeprint", () => {
	const input = document.querySelector<HTMLInputElement>(".page-title");
	if (!input) return;
	let heading = document.querySelector<HTMLElement>(".print-title");
	if (!heading) {
		heading = document.createElement("h1");
		heading.className = "print-title";
		input.after(heading);
	}
	heading.textContent = input.value.trim() || "Untitled";
});
// ⌘P is quick-find here, so ⌘⇧P (or the browser's own menu) prints.
addEventListener("keydown", (event) => {
	if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== "KeyP") return;
	if (!document.querySelector(".page-export")) return;
	event.preventDefault();
	void exportPdf();
});
