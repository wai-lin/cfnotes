/**
 * `<cf-comments data-path data-me data-state>` in the page bar: the
 * Comments button, the side panel with every thread (open and resolved,
 * plus comments on the whole page) and the popover over commented text.
 *
 * The editor marks commented text (`lib/editor`'s comments extension); this
 * keeps the threads, through the page's `comments` action, and tells the
 * editor which marks to highlight. `editorComments()` connects the two.
 */
import type { CommentMarks, CommentsOptions, Person } from "#lib/editor/index.ts";
import { icon, type IconName } from "#lib/icons.ts";
import { alertDialog, confirmDialog } from "#lib/ui/dialog.ts";

import type { Comment, Thread } from "../comments.ts";
import { REACTIONS } from "../reactions.ts";
import { commentBody } from "./body.ts";
import { composer, type Composer, type ComposerOptions } from "./composer.ts";

const tryAgain = "Check your connection and try again.";

/** The editor's marks, once it's up (`null` on a page without an editor). */
let marks: CommentMarks | null = null;

const element = () => document.querySelector<CommentsElement>("cf-comments");

/** What the editor needs: it tells us about marks, and we drive their highlights. */
export const editorComments = (): CommentsOptions => ({
	onStart: (id, quote, mark) => element()?.start(id, quote, mark),
	onOpen: (ids, mark) => element()?.show(ids, mark),
	connect(next) {
		marks = next;
		element()?.paint();
	},
	onPresent: () => element()?.paint(),
});

function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className = "",
	text?: string,
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text !== undefined) el.textContent = text;
	return el;
}

function iconButton(name: IconName, label: string, className = ""): HTMLButtonElement {
	const button = h("button", `cm-icon${className ? ` ${className}` : ""}`);
	button.type = "button";
	button.title = label;
	button.setAttribute("aria-label", label);
	button.innerHTML = icon(name, 15);
	return button;
}

/** "Just now", "5m ago", "3h ago", then the date. */
export function when(ms: number, now = Date.now()): string {
	const minutes = Math.floor((now - ms) / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
	const date = new Date(ms);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
}

/** The name an email is shown by: the part before the @. */
const nameOf = (email: string | null) => (email ? email.split("@")[0]! : "Someone");

type Op =
	| { op: "list" }
	| { op: "start"; thread: string; quote: string | null; body: string }
	| { op: "reply"; thread: string; body: string }
	| { op: "edit"; comment: string; body: string }
	| { op: "delete"; comment: string }
	| { op: "resolve"; thread: string; resolved: boolean }
	| { op: "react"; comment: string; emoji: string };

export class CommentsElement extends HTMLElement {
	#threads: Thread[] = [];
	#me: string | null = null;
	/** Whether the reader may comment (`data-can` is `view` for someone who may only read the page). */
	#canComment = true;
	/** Whether they may comment on some of the text, which marks it in the page: an editor's. */
	#canMark = true;
	#tab: "open" | "resolved" = "open";
	#panelOpen = false;
	/** The thread picked last (its text and card are lit). */
	#active: string | null = null;
	/** A thread being started on marked text, before its first comment is sent. */
	#draft: { id: string; quote: string } | null = null;
	/** The comment being edited. */
	#editing: string | null = null;

	#button = h("button", "ghost cm-toggle");
	#panel = h("aside", "cm-panel");
	#pop: HTMLElement | null = null;
	#popFor: { ids: string[]; mark: HTMLElement } | null = null;
	#off: (() => void)[] = [];
	/** Who can be mentioned (not the reader). */
	#people: Person[] = [];
	/** The comment boxes, by what they're for (`page`, `reply:<thread>`, `edit:<comment>`). */
	#composers = new Map<string, Composer>();
	/** The boxes the redraw under way shows; the rest are let go after it. */
	#shown = new Set<string>();
	/** The comment whose reaction picker is open. */
	#picking: string | null = null;

	connectedCallback() {
		if (this.#off.length > 0) return;
		this.#me = this.dataset.me || null;
		const can = this.dataset.can ?? "owner";
		this.#canComment = can !== "view";
		this.#canMark = can === "owner" || can === "edit";
		try {
			this.#threads = JSON.parse(this.dataset.state ?? "[]") as Thread[];
		} catch {
			this.#threads = [];
		}
		try {
			const emails = JSON.parse(this.dataset.people ?? "[]") as string[];
			this.#people = emails
				.filter((email) => email !== this.#me)
				.map((email) => ({ email, name: nameOf(email) }));
		} catch {
			this.#people = [];
		}
		this.#button.type = "button";
		this.#button.title = "Comments";
		this.#button.setAttribute("aria-label", "Comments");
		this.#button.addEventListener("click", () => this.#togglePanel());
		this.append(this.#button);
		this.#panel.hidden = true;
		this.#panel.setAttribute("aria-label", "Comments");
		document.body.append(this.#panel);

		const onFocus = () => void this.#call({ op: "list" });
		const onScroll = () => this.#placePop();
		const onKey = (event: KeyboardEvent) => {
			// A menu in a comment box (`@`, `[[`) took it.
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (this.#pop) this.#closePop();
			else if (this.#panelOpen && this.#panel.contains(document.activeElement))
				this.#togglePanel(false);
		};
		const onDown = (event: PointerEvent) => {
			const target = event.target as Element;
			if (!this.#pop || this.#pop.contains(target)) return;
			// Clicking other commented text opens its thread instead.
			if (target.closest?.("mark.is-open")) return;
			// Don't throw away a comment being written (or leave its `@`/`[[` menu).
			if (target.closest?.(".slash-menu, .link-pop, .link-card")) return;
			const pop = this.#pop;
			const typed = [...this.#composers.values()].some(
				(box) => pop.contains(box.form) && !box.isEmpty(),
			);
			if (!typed) this.#closePop();
		};
		addEventListener("focus", onFocus);
		addEventListener("scroll", onScroll, true);
		addEventListener("resize", onScroll);
		document.addEventListener("keydown", onKey);
		document.addEventListener("pointerdown", onDown, true);
		this.#off.push(
			() => removeEventListener("focus", onFocus),
			() => removeEventListener("scroll", onScroll, true),
			() => removeEventListener("resize", onScroll),
			() => document.removeEventListener("keydown", onKey),
			() => document.removeEventListener("pointerdown", onDown, true),
		);
		this.paint();
	}

	disconnectedCallback() {
		for (const off of this.#off) off();
		this.#off = [];
		this.#panel.remove();
		this.#pop?.remove();
		this.#button.remove();
		for (const box of this.#composers.values()) box.destroy();
		this.#composers.clear();
	}

	// ---- what the editor calls ----

	/** New marked text: ask for its first comment. */
	start(id: string, quote: string, mark: HTMLElement) {
		if (this.#draft) marks?.remove(this.#draft.id);
		this.#draft = { id, quote };
		this.#active = id;
		this.#openPop([id], mark);
	}

	/** Commented text was clicked. */
	show(ids: string[], mark: HTMLElement) {
		this.#active = ids[0] ?? null;
		if (this.#panelOpen) {
			this.#tab = "open";
			this.paint();
			this.#panel
				.querySelector(`[data-thread="${this.#active}"]`)
				?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		} else this.#openPop(ids, mark);
	}

	/** Draws everything again from the threads. */
	paint() {
		const open = this.#threads.filter((t) => t.resolvedAt === null);
		const lit = new Set(open.map((t) => t.id));
		if (this.#draft) lit.add(this.#draft.id);
		marks?.highlight(lit, this.#pop || this.#panelOpen ? this.#active : null);

		this.#button.innerHTML = icon("messageCircle", 16);
		if (open.length > 0) this.#button.append(h("span", "cm-count", String(open.length)));
		this.#button.classList.toggle("is-on", this.#panelOpen);
		this.#button.setAttribute("aria-expanded", String(this.#panelOpen));

		const focused = [...this.#composers.values()].find((box) => box.hasFocus());
		this.#shown.clear();
		if (this.#panelOpen) this.#drawPanel();
		if (this.#pop && this.#popFor) this.#drawPop();
		for (const [key, box] of this.#composers) {
			if (this.#shown.has(key)) continue;
			box.destroy();
			this.#composers.delete(key);
		}
		// Moving a box out and back in loses focus: give it back.
		if (focused && focused.form.isConnected && !focused.hasFocus()) focused.focus();
	}

	/** The comment box for `key`, made once and kept while it's shown. */
	#compose(key: string, options: ComposerOptions): HTMLFormElement {
		let box = this.#composers.get(key);
		if (box) box.update(options);
		else {
			box = composer(options, () => this.#people);
			box.form.dataset.key = key;
			this.#composers.set(key, box);
		}
		this.#shown.add(key);
		return box.form;
	}

	/** Puts the caret in the first comment box under `root`. */
	#focusBox(root: HTMLElement) {
		for (const box of this.#composers.values()) {
			if (root.contains(box.form)) return box.focus();
		}
	}

	// ---- server ----

	async #call(op: Op): Promise<boolean> {
		const path = this.dataset.path;
		if (!path) return false;
		try {
			const res = await fetch(location.pathname + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(op),
			});
			if (!res.ok) throw new Error(`comments ${op.op} failed: ${res.status}`);
			const before = new Set(this.#threads.map((t) => t.id));
			this.#threads = ((await res.json()) as { threads: Thread[] }).threads;
			// A thread that went (its last comment deleted) takes its marks with it.
			const now = new Set(this.#threads.map((t) => t.id));
			for (const id of before) if (!now.has(id)) marks?.remove(id);
			this.paint();
			return true;
		} catch (error) {
			console.warn("[comments]", error);
			if (op.op !== "list") void alertDialog("Couldn't save the comment", tryAgain);
			return false;
		}
	}

	async #send(thread: string, text: string): Promise<boolean> {
		const draft = this.#draft;
		if (draft && draft.id === thread) {
			const ok = await this.#call({ op: "start", thread, quote: draft.quote, body: text });
			if (ok) {
				this.#draft = null;
				this.paint();
			}
			return ok;
		}
		return this.#call({ op: "reply", thread, body: text });
	}

	async #remove(comment: string) {
		const sure = await confirmDialog({ title: "Delete this comment?" });
		if (sure) await this.#call({ op: "delete", comment });
	}

	// ---- panel ----

	#togglePanel(open = !this.#panelOpen) {
		this.#panelOpen = open;
		this.#panel.hidden = !open;
		document.body.classList.toggle("cm-panel-open", open);
		if (open) this.#closePop();
		this.paint();
		if (open) this.#panel.querySelector<HTMLElement>(".cm-tab.is-on")?.focus();
	}

	#drawPanel() {
		const open = this.#threads.filter((t) => t.resolvedAt === null);
		const resolved = this.#threads.filter((t) => t.resolvedAt !== null);

		const head = h("div", "cm-panel-head");
		const tabs = h("div", "cm-tabs");
		tabs.setAttribute("role", "tablist");
		for (const [tab, label, count] of [
			["open", "Open", open.length],
			["resolved", "Resolved", resolved.length],
		] as const) {
			const button = h("button", `cm-tab${this.#tab === tab ? " is-on" : ""}`, label);
			button.type = "button";
			button.setAttribute("role", "tab");
			button.setAttribute("aria-selected", String(this.#tab === tab));
			if (count > 0) button.append(h("span", "cm-tab-count", String(count)));
			button.addEventListener("click", () => {
				this.#tab = tab;
				this.paint();
			});
			tabs.append(button);
		}
		const close = iconButton("x", "Close comments");
		close.addEventListener("click", () => this.#togglePanel(false));
		head.append(tabs, close);

		const body = h("div", "cm-panel-body");
		if (this.#tab === "open" && this.#canComment) {
			body.append(
				this.#compose("page", {
					placeholder: "Comment on this page… (@ to mention, [[ to link)",
					label: "Comment",
					onSend: (text) =>
						this.#call({ op: "start", thread: crypto.randomUUID(), quote: null, body: text }),
				}),
			);
		}
		const list = this.#ordered(this.#tab === "open" ? open : resolved);
		for (const thread of list) body.append(this.#card(thread));
		if (list.length === 0)
			body.append(
				h(
					"p",
					"cm-empty",
					this.#tab !== "open"
						? "No resolved comments."
						: this.#canMark
							? "No open comments. Select text and choose Comment to start one."
							: "No open comments.",
				),
			);
		this.#panel.replaceChildren(head, body);
	}

	/** Comments on the page first, then the text's in reading order, then those whose text is gone. */
	#ordered(threads: Thread[]): Thread[] {
		const order = [...(marks?.present() ?? [])];
		const rank = (t: Thread) => {
			if (t.quote === null) return -1;
			const at = order.indexOf(t.id);
			return at === -1 ? order.length : at;
		};
		return [...threads].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
	}

	// ---- popover ----

	#openPop(ids: string[], mark: HTMLElement) {
		this.#pop?.remove();
		this.#pop = h("div", "cm-pop");
		this.#pop.setAttribute("role", "dialog");
		this.#pop.setAttribute("aria-label", "Comments");
		this.#popFor = { ids, mark };
		document.body.append(this.#pop);
		this.paint();
		this.#placePop();
		this.#focusBox(this.#pop);
	}

	#closePop() {
		if (!this.#pop) return;
		this.#pop.remove();
		this.#pop = null;
		this.#popFor = null;
		this.#editing = null;
		if (this.#draft) {
			marks?.remove(this.#draft.id);
			this.#draft = null;
		}
		this.#active = null;
		this.paint();
	}

	#drawPop() {
		const pop = this.#pop!;
		const { ids } = this.#popFor!;
		const cards: HTMLElement[] = [];
		for (const id of ids) {
			if (this.#draft?.id === id) {
				cards.push(this.#draftCard(this.#draft));
				continue;
			}
			const thread = this.#threads.find((t) => t.id === id && t.resolvedAt === null);
			if (thread) cards.push(this.#card(thread, { quote: false }));
		}
		if (cards.length === 0) return this.#closePop();
		pop.replaceChildren(...cards);
		this.#placePop();
	}

	#placePop() {
		const pop = this.#pop;
		const mark = this.#popFor?.mark;
		if (!pop || !mark) return;
		if (!mark.isConnected) {
			// The mark was drawn again: find it by its thread.
			const again = marks?.find(this.#popFor!.ids[0]!);
			if (!again) return;
			this.#popFor!.mark = again;
		}
		const box = this.#popFor!.mark.getBoundingClientRect();
		const below = box.bottom + 6;
		const fitsBelow = below + pop.offsetHeight < innerHeight - 8;
		pop.style.top = `${fitsBelow ? below : Math.max(8, box.top - pop.offsetHeight - 6)}px`;
		pop.style.left = `${Math.max(8, Math.min(box.left, innerWidth - pop.offsetWidth - 8))}px`;
	}

	// ---- cards ----

	#draftCard(draft: { id: string; quote: string }): HTMLElement {
		const card = h("div", "cm-thread is-draft");
		card.append(
			this.#compose(`reply:${draft.id}`, {
				placeholder: "Add a comment…",
				label: "Comment",
				onSend: (text) => this.#send(draft.id, text),
				onCancel: () => this.#closePop(),
			}),
		);
		return card;
	}

	#card(thread: Thread, { quote = true } = {}): HTMLElement {
		const card = h("div", "cm-thread");
		card.dataset.thread = thread.id;
		card.classList.toggle("is-active", thread.id === this.#active);
		const resolved = thread.resolvedAt !== null;

		const top = h("div", "cm-thread-top");
		if (quote && thread.quote !== null) {
			const gone = !marks?.present().has(thread.id);
			const q = h("button", `cm-quote${gone ? " is-gone" : ""}`, thread.quote);
			q.type = "button";
			q.title = gone ? "This text was deleted" : "Show in the page";
			if (!gone)
				q.addEventListener("click", () => {
					this.#active = thread.id;
					marks?.reveal(thread.id);
					this.paint();
				});
			top.append(q);
		} else if (quote) top.append(h("span", "cm-on-page", "On this page"));
		const toggle = resolved
			? iconButton("arrowBackUp", "Reopen", "cm-resolve")
			: iconButton("circleCheck", "Resolve", "cm-resolve");
		toggle.addEventListener("click", () => {
			void this.#call({ op: "resolve", thread: thread.id, resolved: !resolved });
		});
		if (this.#canComment) top.append(toggle);
		card.append(top);

		for (const comment of thread.comments) {
			const item = h("div", "cm-comment");
			const head = h("div", "cm-head");
			head.append(
				h("span", "cm-avatar", nameOf(comment.author)[0]!.toUpperCase()),
				Object.assign(h("span", "cm-who", nameOf(comment.author)), {
					title: comment.author ?? "",
				}),
				Object.assign(h("time", "cm-when", when(comment.createdAt)), {
					title: new Date(comment.createdAt).toLocaleString(),
				}),
			);
			if (comment.editedAt !== null) head.append(h("span", "cm-edited", "(edited)"));
			const mine = comment.author === null || comment.author === this.#me;
			const tools = h("span", "cm-tools");
			if (this.#canComment && this.#editing !== comment.id) {
				const add = iconButton("moodSmile", "Add a reaction", "cm-react-add");
				add.setAttribute("aria-expanded", String(this.#picking === comment.id));
				add.addEventListener("click", () => {
					this.#picking = this.#picking === comment.id ? null : comment.id;
					this.paint();
				});
				tools.append(add);
			}
			if (mine && this.#editing !== comment.id) {
				const edit = iconButton("pencil", "Edit");
				edit.addEventListener("click", () => {
					this.#editing = comment.id;
					this.paint();
					this.#composers.get(`edit:${comment.id}`)?.focus();
				});
				const del = iconButton("trash", "Delete");
				del.addEventListener("click", () => void this.#remove(comment.id));
				tools.append(edit, del);
			}
			if (tools.childElementCount > 0) head.append(tools);
			item.append(head);
			if (this.#editing === comment.id) {
				const form = this.#compose(`edit:${comment.id}`, {
					placeholder: "Edit the comment…",
					value: comment.body,
					label: "Save",
					onSend: async (text) => {
						const ok = await this.#call({ op: "edit", comment: comment.id, body: text });
						if (ok) {
							this.#editing = null;
							this.paint();
						}
						return ok;
					},
					onCancel: () => {
						this.#editing = null;
						this.paint();
					},
				});
				item.append(form);
			} else {
				item.append(commentBody(comment.body));
				const reactions = this.#reactions(comment);
				if (reactions) item.append(reactions);
			}
			card.append(item);
		}

		if (resolved) {
			card.append(
				h(
					"div",
					"cm-resolved",
					`Resolved by ${nameOf(thread.resolvedBy)} · ${when(thread.resolvedAt!)}`,
				),
			);
		} else if (this.#canComment) {
			card.append(
				this.#compose(`reply:${thread.id}`, {
					placeholder: "Reply…",
					label: "Reply",
					onSend: (text) => this.#send(thread.id, text),
					onCancel: this.#pop ? () => this.#closePop() : undefined,
				}),
			);
		}
		return card;
	}

	// ---- reactions ----

	/** A comment's reactions, each a toggle for the reader, and the picker when it's open. */
	#reactions(comment: Comment): HTMLElement | null {
		const picking = this.#canComment && this.#picking === comment.id;
		if (comment.reactions.length === 0 && !picking) return null;
		const row = h("div", "cm-reactions");
		const react = (emoji: string) => {
			this.#picking = null;
			void this.#call({ op: "react", comment: comment.id, emoji });
		};
		for (const reaction of comment.reactions) {
			const mine = this.#me !== null && reaction.people.includes(this.#me);
			const pill = h("button", `cm-reaction${mine ? " is-mine" : ""}`);
			pill.type = "button";
			pill.title = reaction.people.map(nameOf).join(", ");
			pill.setAttribute("aria-pressed", String(mine));
			pill.append(reaction.emoji, h("span", "cm-reaction-count", String(reaction.people.length)));
			pill.disabled = !this.#canComment;
			pill.addEventListener("click", () => react(reaction.emoji));
			row.append(pill);
		}
		if (picking) {
			const pick = h("div", "cm-react-pick");
			pick.setAttribute("role", "group");
			pick.setAttribute("aria-label", "Reactions");
			for (const emoji of REACTIONS) {
				const button = h("button", "cm-react-choice", emoji);
				button.type = "button";
				button.title = `React with ${emoji}`;
				button.addEventListener("click", () => react(emoji));
				pick.append(button);
			}
			row.append(pick);
		}
		return row;
	}
}

export const defineComments = () => {
	if (!customElements.get("cf-comments")) customElements.define("cf-comments", CommentsElement);
};
