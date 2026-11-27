/**
 * A database row's page in a popup over the page it's opened from, as a frame
 * of `/p/<id>?embed=1` (the page without its sidebar), with Close and "Open as
 * full page". Opening a row from inside the popup shows that row in it instead.
 */
import { icon } from "#lib/icons.ts";

/** Whether this document is the page inside a popup. */
const embedded = new URLSearchParams(location.search).get("embed") === "1";

const embedHref = (id: string) => `/p/${id}?embed=1`;

/** Cmd/Ctrl/Shift-click or a middle click: the reader asked for a tab or window. */
const wantsTab = (event?: Event) =>
	event instanceof MouseEvent &&
	(event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);

/** Opens page `id` (a database row) in the popup, or in a new tab when the click asked for one. */
export function openPage(id: string, event?: Event): void {
	if (wantsTab(event)) {
		window.open(`/p/${id}`, "_blank", "noopener");
		return;
	}
	if (embedded) location.assign(embedHref(id));
	else peek().show(id);
}

/** For a link to a row: a plain click opens the popup, other clicks do what links do. */
export function peekOnClick(link: HTMLAnchorElement, id: string): void {
	link.addEventListener("click", (event) => {
		if (event.button !== 0 || wantsTab(event)) return;
		event.preventDefault();
		event.stopPropagation();
		openPage(id);
	});
}

type Peek = { show(id: string): void };
let made: Peek | null = null;

function peek(): Peek {
	if (made) return made;
	const dialog = document.createElement("dialog");
	dialog.className = "peek";
	dialog.setAttribute("aria-label", "Page");
	const bar = document.createElement("div");
	bar.className = "peek-bar";
	const full = document.createElement("a");
	full.className = "peek-btn peek-full";
	full.title = "Open as full page";
	full.setAttribute("aria-label", "Open as full page");
	full.innerHTML = icon("arrowsDiagonal", 16);
	const close = document.createElement("button");
	close.type = "button";
	close.className = "peek-btn peek-close";
	close.title = "Close";
	close.setAttribute("aria-label", "Close");
	close.innerHTML = icon("x", 16);
	bar.append(full, close);
	const frame = document.createElement("iframe");
	frame.className = "peek-frame";
	frame.title = "Page";
	dialog.append(bar, frame);
	document.body.append(dialog);

	/** Bumped on each open, so a slow close doesn't blank a page opened since. */
	let session = 0;

	const finish = async () => {
		if (!dialog.open) return;
		const mine = ++session;
		const inner = frame.contentDocument;
		dialog.close();
		// Send the edit the editor's debounce may still hold, and let a title's settle.
		const editor = inner?.querySelector<HTMLElement & { flush?: () => Promise<boolean> }>(
			"notes-editor",
		);
		await Promise.all([editor?.flush?.(), new Promise((done) => setTimeout(done, 450))]);
		if (mine !== session) return;
		frame.src = "about:blank";
		// The rows here may show what changed: their titles and properties.
		const ids = [...document.querySelectorAll<HTMLElement>("cf-database[data-id]")].map(
			(db) => db.dataset.id!,
		);
		if (ids.length > 0)
			document.dispatchEvent(
				new CustomEvent("cf-database-dirty", { detail: { source: "peek", ids } }),
			);
	};

	close.addEventListener("click", () => void finish());
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		void finish();
	});
	// A click on the dim area around it.
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) void finish();
	});

	frame.addEventListener("load", () => {
		if (!dialog.open) return;
		let url: URL;
		try {
			url = new URL(frame.contentWindow!.location.href);
		} catch {
			return;
		}
		if (url.href === "about:blank") return;
		// It left the popup (Delete's way back, a page that's gone): follow it here.
		if (url.searchParams.get("embed") !== "1") {
			session++;
			dialog.close();
			location.assign(url.pathname + url.search + url.hash);
			return;
		}
		full.href = url.pathname;
		const win = frame.contentWindow!;
		// Escape closes it, unless something inside (a menu, a dialog) took it.
		win.addEventListener("keydown", (event) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (win.document.querySelector("dialog[open]")) return;
			void finish();
		});
	});

	made = {
		show(id) {
			session++;
			full.href = `/p/${id}`;
			frame.src = embedHref(id);
			if (!dialog.open) dialog.showModal();
			frame.focus();
		},
	};
	return made;
}
