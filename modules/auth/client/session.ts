/**
 * The session in the browser. When it ends under an open page, saves start
 * failing: say so, don't let the reader leave with unsaved edits, and save
 * them once they've signed in again (in another tab, so this one keeps them).
 * Signing out saves first.
 */
import { alertDialog } from "#lib/ui/dialog.ts";
import { toast, type ToastHandle } from "#lib/ui/toast.ts";
import type { NotesEditorElement } from "#modules/pages/client/notes-editor.ts";

let signedOut = false;
let unsaved = false;
let notice: ToastHandle | undefined;

function showNotice(): void {
	notice?.dismiss();
	notice = toast({
		title: "You've been signed out",
		description: "Sign in, then come back to this tab to save what you typed.",
		type: "error",
		duration: Infinity,
		action: { label: "Sign in", run: () => void window.open("/login", "_blank") },
	});
}

const send = window.fetch.bind(window);

// Every request, Datastar's too: they all go through `fetch`.
window.fetch = async (input, init) => {
	const response = await send(input, init);
	if (response.status === 401 && response.headers.has("x-signed-out")) {
		const method = init?.method ?? (input instanceof Request ? input.method : "GET");
		if (method.toUpperCase() !== "GET") unsaved = true;
		if (!signedOut) showNotice();
		signedOut = true;
	}
	return response;
};

addEventListener("beforeunload", (event) => {
	if (unsaved) event.preventDefault();
});

let checking = false;

async function recheck(): Promise<void> {
	if (!signedOut || checking || document.hidden) return;
	checking = true;
	try {
		if (!(await send("/auth/session")).ok) return showNotice();
		notice?.dismiss();
		signedOut = false;
		if (unsaved) {
			unsaved = false;
			document.querySelector<NotesEditorElement>("notes-editor")?.resave?.();
			const title = document.querySelector<HTMLInputElement>(".page-title");
			if (title && title.value !== title.defaultValue)
				title.dispatchEvent(new Event("input", { bubbles: true }));
		}
		toast({ title: "Signed in again" });
	} catch (error) {
		console.warn("[session]", error);
	} finally {
		checking = false;
	}
}

addEventListener("focus", () => void recheck());
document.addEventListener("visibilitychange", () => void recheck());

/** Longer than the title's debounced save. */
const TITLE_SAVE_MS = 500;

document.addEventListener("submit", async (event) => {
	const form = event.target as HTMLFormElement;
	if (!form.matches("form[data-sign-out]")) return;
	event.preventDefault();
	const title = document.querySelector<HTMLInputElement>(".page-title");
	if (title && title.value !== title.defaultValue)
		await new Promise((done) => setTimeout(done, TITLE_SAVE_MS));
	const saved =
		(await document.querySelector<NotesEditorElement>("notes-editor")?.flush?.()) ?? true;
	if (saved || signedOut) form.submit();
	else void alertDialog("Couldn't save your last edits", "You're still signed in. Try again.");
});
