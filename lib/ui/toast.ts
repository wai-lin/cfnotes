/**
 * Toasts, stacked like Sonner's: the newest sits at the bottom right with up to
 * two peeking out behind it; hovering (or focusing) the stack fans them all out.
 * Timers pause while the stack is open or the tab is hidden. Leaving the page
 * carries the live toasts (with the time they had left) to the next one.
 *
 * The stack itself lives on `window`, so every copy of this module (after a
 * hot reload, or in another entry) talks to the same one.
 */

import { icon } from "#lib/icons.ts";

export type ToastType = "success" | "info" | "error";

export type ToastOptions = {
	title: string;
	description?: string;
	type?: ToastType;
	/** How long it stays, in ms (default 4000; `Infinity` keeps it until dismissed). */
	duration?: number;
	/** Show the time left as a ring with the seconds in it. */
	countdown?: boolean;
	/** One button, e.g. Undo. Clicking it dismisses the toast. */
	action?: { label: string; run: () => void | Promise<void> };
	/** Called once the toast is gone, however it went. `byAction` when its button closed it. */
	onClose?: (byAction: boolean) => void;
	/** Time left when it appears, in ms (default: all of `duration`). */
	remaining?: number;
	/**
	 * How to show it again on the next page if the reader leaves while it's up.
	 * A toast without an action carries itself; one with an action only if given this.
	 */
	carry?: PendingToast;
};

export type ToastHandle = { dismiss: () => void };

/** Toasts to show on the next page, e.g. after a form post redirects. */
export type PendingToast = Omit<ToastOptions, "action" | "onClose" | "carry"> & {
	/** An Undo that restores this trashed page; `title` is the page's (see `_undo.ts`). */
	undoArchive?: { id: string; reopen?: boolean };
	/** An Undo that brings back a deleted folder; `title` is its name (see `_undo.ts`). */
	undoFolder?: Record<string, unknown>;
};

const GAP = 14; // between fanned-out toasts
const PEEK = 14; // how far the ones behind show when stacked
const VISIBLE = 3; // stacked toasts that show at all
const PENDING_KEY = "cfnotes:toasts";

type Item = {
	id: number;
	el: HTMLElement;
	height: number;
	opts: ToastOptions;
	remaining: number;
	startedAt: number;
	closing: boolean;
	ring?: SVGCircleElement;
	count?: HTMLElement;
};

const RING = 2 * Math.PI * 8;

function createToaster() {
	const root = document.createElement("section");
	root.className = "toaster";
	root.setAttribute("aria-label", "Notifications");
	root.setAttribute("aria-live", "polite");
	root.tabIndex = -1;
	const list = document.createElement("ol");
	list.className = "toaster-list";
	root.append(list);

	let items: Item[] = []; // newest first
	let seq = 0;
	let expanded = false;
	let hovering = false;
	let frame = 0;

	const mount = () => {
		if (!root.isConnected) document.body.append(root);
	};

	const paused = () => expanded || document.hidden;

	function layout() {
		const live = items.filter((t) => !t.closing);
		const front = live[0];
		root.classList.toggle("is-expanded", expanded);
		root.hidden = items.length === 0;
		let offset = 0;
		live.forEach((t, i) => {
			const s = t.el.style;
			t.el.dataset.front = String(i === 0);
			t.el.classList.toggle("is-hidden", !expanded && i >= VISIBLE);
			t.el.setAttribute("aria-hidden", String(!expanded && i > 0));
			if (expanded) {
				s.transform = `translateY(${-offset}px)`;
				s.height = `${t.height}px`;
				offset += t.height + GAP;
			} else {
				const depth = Math.min(i, VISIBLE);
				s.transform = `translateY(${-depth * PEEK}px) scale(${1 - depth * 0.05})`;
				s.height = `${front?.height ?? t.height}px`;
			}
			s.zIndex = String(live.length - i);
		});
		const stack = expanded
			? offset - GAP
			: (front?.height ?? 0) + Math.min(live.length - 1, VISIBLE - 1) * PEEK;
		root.style.height = `${Math.max(stack, 0)}px`;
	}

	function tick() {
		frame = 0;
		const now = performance.now();
		for (const t of items) {
			if (t.closing || !Number.isFinite(t.remaining)) continue;
			const left = paused() ? t.remaining : t.remaining - (now - t.startedAt);
			if (left <= 0) {
				close(t, false);
				continue;
			}
			if (t.ring && t.count) {
				const total = t.opts.duration ?? 4000;
				t.ring.style.strokeDashoffset = String(RING * (1 - left / total));
				t.count.textContent = String(Math.ceil(left / 1000));
			}
		}
		if (items.some((t) => !t.closing && Number.isFinite(t.remaining))) {
			frame = requestAnimationFrame(tick);
		}
	}
	const run = () => {
		if (!frame) frame = requestAnimationFrame(tick);
	};

	/** Banks the time that ran while the stack was closed (call on every pause/resume). */
	function settle(pausing: boolean) {
		const now = performance.now();
		for (const t of items) {
			if (pausing) t.remaining -= now - t.startedAt;
			t.startedAt = now;
		}
	}

	function setExpanded(next: boolean) {
		if (next === expanded) return;
		if (!document.hidden) settle(next);
		expanded = next;
		layout();
	}

	function close(t: Item, byAction: boolean) {
		if (t.closing) return;
		t.closing = true;
		t.el.classList.add("is-leaving");
		t.el.setAttribute("aria-hidden", "true");
		layout();
		const done = () => {
			t.el.remove();
			items = items.filter((x) => x !== t);
			if (items.length === 0) {
				expanded = false;
				hovering = false;
			}
			layout();
		};
		window.setTimeout(done, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
		t.opts.onClose?.(byAction);
	}

	function show(opts: ToastOptions): ToastHandle {
		mount();
		const type = opts.type ?? "success";
		const el = document.createElement("li");
		el.className = "toast";
		el.dataset.type = type;
		el.setAttribute("role", type === "error" ? "alert" : "status");

		const badge = document.createElement("span");
		badge.className = "toast-icon";
		badge.innerHTML = icon(
			type === "error" ? "x" : type === "info" ? "infoCircle" : "check",
			16,
			2,
		);
		const body = document.createElement("div");
		body.className = "toast-body";
		const title = document.createElement("div");
		title.className = "toast-title";
		title.textContent = opts.title;
		body.append(title);
		if (opts.description) {
			const desc = document.createElement("div");
			desc.className = "toast-description";
			desc.textContent = opts.description;
			body.append(desc);
		}
		el.append(badge, body);

		const duration = opts.duration ?? 4000;
		const item: Item = {
			id: ++seq,
			el,
			height: 0,
			opts: { ...opts, duration },
			remaining: Math.min(opts.remaining ?? duration, duration),
			startedAt: performance.now(),
			closing: false,
		};

		if (opts.countdown && Number.isFinite(duration)) {
			const timer = document.createElement("span");
			timer.className = "toast-timer";
			timer.setAttribute("aria-hidden", "true");
			timer.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20"><circle class="toast-timer-track" cx="10" cy="10" r="8"/><circle class="toast-timer-ring" cx="10" cy="10" r="8" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg><span class="toast-timer-count">${Math.ceil(duration / 1000)}</span>`;
			item.ring = timer.querySelector<SVGCircleElement>(".toast-timer-ring") ?? undefined;
			item.count = timer.querySelector<HTMLElement>(".toast-timer-count") ?? undefined;
			el.append(timer);
		}
		if (opts.action) {
			const action = opts.action;
			const button = document.createElement("button");
			button.type = "button";
			button.className = "toast-action";
			button.textContent = action.label;
			button.addEventListener("click", () => {
				close(item, true);
				void action.run();
			});
			el.append(button);
		}
		const x = document.createElement("button");
		x.type = "button";
		x.className = "toast-close";
		x.setAttribute("aria-label", "Dismiss");
		x.innerHTML = icon("x", 12, 2);
		x.addEventListener("click", () => close(item, false));
		el.append(x);

		// Measure at full size, then slide in from below.
		el.classList.add("is-entering");
		root.hidden = false; // an empty stack is hidden, and hidden things measure 0
		list.prepend(el);
		item.height = el.getBoundingClientRect().height;
		items.unshift(item);
		layout();
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				el.classList.remove("is-entering");
			}),
		);
		run();
		return { dismiss: () => close(item, false) };
	}

	root.addEventListener("mouseenter", () => {
		hovering = true;
		setExpanded(true);
	});
	root.addEventListener("mouseleave", () => {
		hovering = false;
		if (!root.contains(document.activeElement)) setExpanded(false);
	});
	root.addEventListener("focusin", () => setExpanded(true));
	root.addEventListener("focusout", (e) => {
		if (!hovering && !root.contains(e.relatedTarget as Node | null)) setExpanded(false);
	});
	document.addEventListener("visibilitychange", () => {
		if (!expanded) settle(document.hidden);
		run();
	});
	// Leaving the page: the toasts still up continue on the next one, oldest
	// first so the stack keeps its order, before any queued with `toastNextPage`.
	window.addEventListener("pagehide", () => {
		const now = performance.now();
		const carried: PendingToast[] = [];
		for (const t of [...items].reverse()) {
			if (t.closing) continue;
			const left = paused() ? t.remaining : t.remaining - (now - t.startedAt);
			if (left < 500) continue;
			const { title, description, type, duration, countdown } = t.opts;
			const carry =
				t.opts.carry ?? (t.opts.action ? null : { title, description, type, duration, countdown });
			if (carry) carried.push({ ...carry, duration, countdown, remaining: left });
		}
		if (carried.length === 0) return;
		try {
			const queued = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]") as PendingToast[];
			sessionStorage.setItem(PENDING_KEY, JSON.stringify([...carried, ...queued]));
		} catch {}
	});

	// Escape closes the newest while the stack is open.
	root.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			const front = items.find((t) => !t.closing);
			if (front) close(front, false);
		}
	});

	return { show, settle, run };
}

type Toaster = ReturnType<typeof createToaster>;

function toaster(): Toaster {
	const w = window as unknown as { __cfToaster?: Toaster };
	w.__cfToaster ??= createToaster();
	return w.__cfToaster;
}

/** Shows a toast; returns a handle to dismiss it early. */
export function toast(options: ToastOptions): ToastHandle {
	return toaster().show(options);
}

/** Queues a toast for the next page load (it survives a navigation). */
export function toastNextPage(pending: PendingToast): void {
	try {
		const list = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]") as PendingToast[];
		list.push(pending);
		sessionStorage.setItem(PENDING_KEY, JSON.stringify(list));
	} catch {}
}

/** Takes the toasts queued by `toastNextPage`. */
export function takePendingToasts(): PendingToast[] {
	try {
		const list = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "[]") as PendingToast[];
		sessionStorage.removeItem(PENDING_KEY);
		return Array.isArray(list) ? list : [];
	} catch {
		return [];
	}
}
