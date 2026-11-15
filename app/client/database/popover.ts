import { icon, type IconName } from "@modules/icons";

export type MenuEntry =
	| { heading: string }
	| { separator: true }
	| {
			label: string;
			icon?: IconName;
			checked?: boolean;
			disabled?: boolean;
			danger?: boolean;
			run: () => unknown;
	  };

type Build = (
	panel: HTMLElement,
	refocus: (el: HTMLInputElement, select?: boolean) => void,
) => void;

/**
 * One floating panel at a time, anchored under an element. `build` draws its
 * contents and runs again on `refresh()`, so menus can show new state.
 */
export class Popover {
	#panel: HTMLElement | null = null;
	#anchor: HTMLElement | null = null;
	#build: Build | null = null;
	#onClose: (() => void) | null = null;
	#cleanup: (() => void) | null = null;

	get isOpen(): boolean {
		return this.#panel !== null;
	}

	open(anchor: HTMLElement, build: Build, onClose?: () => void): void {
		this.close();
		const panel = document.createElement("div");
		panel.className = "db-pop";
		panel.setAttribute("role", "dialog");
		document.body.append(panel);
		this.#panel = panel;
		this.#anchor = anchor;
		this.#build = build;
		this.#onClose = onClose ?? null;

		const onDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (!panel.contains(target) && !anchor.contains(target)) this.close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				this.close();
			} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				// Move between menu items (inputs handle their own arrows).
				if ((e.target as Element).closest("input")) return;
				const items = [...panel.querySelectorAll<HTMLElement>(".db-menu-item:not(:disabled)")];
				if (!items.length) return;
				e.preventDefault();
				const at = items.indexOf(document.activeElement as HTMLElement);
				const step = e.key === "ArrowDown" ? 1 : -1;
				items[(at + step + items.length) % items.length]!.focus();
			}
		};
		const onScroll = (e: Event) => {
			if (!panel.contains(e.target as Node)) this.#place();
		};
		const onResize = () => this.close();
		// Capture: clicks inside an inline database don't bubble past it.
		document.addEventListener("pointerdown", onDown, true);
		panel.addEventListener("keydown", onKey);
		window.addEventListener("scroll", onScroll, true);
		window.addEventListener("resize", onResize);
		this.#cleanup = () => {
			document.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onResize);
		};
		this.refresh();
	}

	/** Draws the contents again (keeping focus in the same input, if any). */
	refresh(): void {
		const panel = this.#panel;
		if (!panel || !this.#build) return;
		const focus: { el?: HTMLInputElement; select?: boolean } = {};
		panel.replaceChildren();
		this.#build(panel, (el, select) => {
			focus.el = el;
			focus.select = select;
		});
		this.#place();
		if (focus.el) {
			focus.el.focus();
			if (focus.select) focus.el.select();
			else if (["text", "search", "url"].includes(focus.el.type)) {
				// Other input types (number, date) don't allow placing the caret.
				focus.el.setSelectionRange(focus.el.value.length, focus.el.value.length);
			}
		} else {
			panel.querySelector<HTMLElement>(".db-menu-item:not(:disabled)")?.focus();
		}
	}

	close(): void {
		if (!this.#panel) return;
		const onClose = this.#onClose;
		this.#cleanup?.();
		this.#panel.remove();
		this.#panel = this.#anchor = this.#build = this.#onClose = this.#cleanup = null;
		onClose?.();
	}

	/** Menu items; choosing one closes the panel first (after `beforeRun`, e.g. saving a rename). */
	menu(entries: MenuEntry[], beforeRun?: () => void): HTMLElement {
		const list = document.createElement("div");
		list.className = "db-menu";
		list.setAttribute("role", "menu");
		for (const entry of entries) {
			if ("heading" in entry) {
				const heading = document.createElement("div");
				heading.className = "db-pop-label";
				heading.textContent = entry.heading;
				list.append(heading);
			} else if ("separator" in entry) {
				list.append(Object.assign(document.createElement("div"), { className: "db-menu-sep" }));
			} else {
				const item = document.createElement("button");
				item.type = "button";
				item.className = `db-menu-item${entry.danger ? " is-danger" : ""}`;
				item.setAttribute("role", "menuitem");
				item.disabled = Boolean(entry.disabled);
				if (entry.icon) item.insertAdjacentHTML("beforeend", icon(entry.icon, 15));
				const label = document.createElement("span");
				label.textContent = entry.label;
				item.append(label);
				if (entry.checked) item.insertAdjacentHTML("beforeend", icon("check", 14));
				item.addEventListener("click", () => {
					beforeRun?.();
					// Not `close()`: that would run the panel's onClose a second time.
					this.#onClose = null;
					this.close();
					void entry.run();
				});
				list.append(item);
			}
		}
		return list;
	}

	#place() {
		const panel = this.#panel;
		const anchor = this.#anchor;
		// After the view redraws, the anchor is gone; the panel stays where it is.
		if (!panel || !anchor?.isConnected) return;
		const box = anchor.getBoundingClientRect();
		const width = panel.offsetWidth;
		const height = panel.offsetHeight;
		const below = box.bottom + 4;
		const top = below + height > innerHeight - 8 ? Math.max(8, box.top - height - 4) : below;
		panel.style.top = `${top}px`;
		panel.style.left = `${Math.max(8, Math.min(box.left, innerWidth - width - 8))}px`;
	}
}
