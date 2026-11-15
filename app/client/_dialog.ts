/**
 * In-page modals that replace the browser's `alert()` and `confirm()`.
 *
 * Both use a native `<dialog>` opened with `showModal()`, so focus stays inside,
 * the page behind is inert and Escape cancels. Only one is open at a time; a
 * second call waits for the first to close.
 */

export type ConfirmOptions = {
	/** The question, e.g. "Delete this page?". */
	title: string;
	/** An optional line of detail below the title. */
	message?: string;
	/** The confirm button's label (default "Delete"). */
	confirmLabel?: string;
	/** Draws the confirm button in red (default true). */
	danger?: boolean;
};

let queue: Promise<unknown> = Promise.resolve();

function open(
	opts: { title: string; message?: string; ok: string; cancel?: string; danger: boolean },
	restoreFocus = document.activeElement as HTMLElement | null,
): Promise<boolean> {
	return new Promise((resolve) => {
		const dialog = document.createElement("dialog");
		dialog.className = "cf-dialog";
		dialog.setAttribute("role", opts.cancel ? "alertdialog" : "dialog");
		const title = document.createElement("h2");
		title.className = "cf-dialog-title";
		title.id = `cf-dialog-${Math.random().toString(36).slice(2)}`;
		title.textContent = opts.title;
		dialog.setAttribute("aria-labelledby", title.id);
		dialog.append(title);
		if (opts.message) {
			const message = document.createElement("p");
			message.className = "cf-dialog-message";
			message.textContent = opts.message;
			dialog.append(message);
		}
		const bar = document.createElement("div");
		bar.className = "cf-dialog-actions";
		const ok = document.createElement("button");
		ok.type = "button";
		ok.className = `cf-dialog-ok${opts.danger ? " is-danger" : ""}`;
		ok.textContent = opts.ok;
		if (opts.cancel) {
			const cancel = document.createElement("button");
			cancel.type = "button";
			cancel.className = "cf-dialog-cancel";
			cancel.textContent = opts.cancel;
			cancel.addEventListener("click", () => finish(false));
			bar.append(cancel);
		}
		bar.append(ok);
		dialog.append(bar);

		let done = false;
		const finish = (result: boolean) => {
			if (done) return;
			done = true;
			dialog.close();
			dialog.remove();
			if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
			resolve(result);
		};
		ok.addEventListener("click", () => finish(true));
		// Escape (the dialog's cancel event) and clicks on the backdrop say no.
		dialog.addEventListener("cancel", (event) => {
			event.preventDefault();
			finish(false);
		});
		dialog.addEventListener("click", (event) => {
			if (event.target === dialog) finish(false);
		});
		// Keys typed here are the dialog's, not the editor's or the page's shortcuts.
		dialog.addEventListener("keydown", (event) => event.stopPropagation());

		document.body.append(dialog);
		dialog.showModal();
		// Enter confirms, Escape cancels.
		ok.focus();
	});
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
	const next = queue.then(run, run);
	queue = next.catch(() => {});
	return next;
}

/** Asks a yes/no question; resolves `true` when the reader confirms. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
	const restore = document.activeElement as HTMLElement | null;
	return enqueue(() =>
		open(
			{
				title: options.title,
				message: options.message,
				ok: options.confirmLabel ?? "Delete",
				cancel: "Cancel",
				danger: options.danger ?? true,
			},
			restore,
		),
	);
}

/** Shows a message with an OK button; resolves when it's dismissed. */
export function alertDialog(title: string, message?: string): Promise<void> {
	const restore = document.activeElement as HTMLElement | null;
	return enqueue(() => open({ title, message, ok: "OK", danger: false }, restore)).then(
		() => undefined,
	);
}

/**
 * Forms with `data-confirm="Question?"` ask first (`data-confirm-message`,
 * `data-confirm-label` fill in the rest). `data-confirm-alt` replaces the
 * question while `data-confirm-alt-when` (a selector) matches something on the page.
 */
export function registerConfirmForms(root: Document = document): void {
	root.addEventListener(
		"submit",
		(event) => {
			const form = event.target;
			if (!(form instanceof HTMLFormElement) || !form.dataset.confirm) return;
			if (form.dataset.confirmed === "1") {
				delete form.dataset.confirmed;
				return;
			}
			event.preventDefault();
			event.stopImmediatePropagation();
			const { confirm, confirmAlt, confirmAltWhen, confirmMessage, confirmLabel } = form.dataset;
			const useAlt = confirmAlt && confirmAltWhen && document.querySelector(confirmAltWhen);
			const submitter = (event as SubmitEvent).submitter;
			void confirmDialog({
				title: useAlt ? confirmAlt : confirm,
				message: confirmMessage || undefined,
				confirmLabel: confirmLabel || undefined,
			}).then((yes) => {
				if (!yes) return;
				form.dataset.confirmed = "1";
				form.requestSubmit(submitter instanceof HTMLElement ? submitter : undefined);
			});
		},
		true,
	);
}
