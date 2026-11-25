/**
 * The Share dialog, for owners: who a page or folder is shared with and as
 * what (view, comment, edit), inviting someone by email, and the link to send
 * them. Friends sign in with Google using the email they were invited with.
 * Every change is one POST to the sidebar's `share` action, which answers with
 * the people.
 */
import { alertDialog } from "#lib/ui/dialog.ts";

type Role = "view" | "comment" | "edit";

interface Person {
	email: string;
	role: Role;
}

const ROLE_LABELS: Record<Role, string> = {
	view: "Can view",
	comment: "Can comment",
	edit: "Can edit",
};

const PROBLEMS: Record<string, string> = {
	invalid_email: "That isn't an email address.",
	already_owner: "They own this workspace already, so they can open everything.",
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
	const el = document.createElement(tag);
	if (className) el.className = className;
	if (text) el.textContent = text;
	return el;
}

function roleSelect(value: Role, label: string): HTMLSelectElement {
	const select = h("select", "share-role");
	select.setAttribute("aria-label", label);
	for (const role of Object.keys(ROLE_LABELS) as Role[]) {
		const option = h("option", "", ROLE_LABELS[role]);
		option.value = role;
		option.selected = role === value;
		select.append(option);
	}
	return select;
}

export function openShareDialog(target: {
	kind: "page" | "folder";
	id: string;
	title: string;
	/** The sidebar's `share` action, relative to this page. */
	path: string;
}): void {
	const restore = document.activeElement as HTMLElement | null;
	const dialog = h("dialog", "cf-dialog share-dialog");
	const title = h("h2", "cf-dialog-title", `Share “${target.title || "Untitled"}”`);
	title.id = `share-${target.id}`;
	dialog.setAttribute("aria-labelledby", title.id);
	const what = target.kind === "folder" ? "this folder and everything in it" : "this page";
	const note = h(
		"p",
		"cf-dialog-message",
		`People you add can open ${what} after signing in with Google as that email.`,
	);

	const form = h("form", "share-invite");
	const email = h("input", "share-email");
	email.type = "email";
	email.required = true;
	email.placeholder = "friend@example.com";
	email.setAttribute("aria-label", "Email to share with");
	email.autocomplete = "off";
	const role = roleSelect("view", "Their access");
	const invite = h("button", "btn is-primary", "Invite");
	invite.type = "submit";
	form.append(email, role, invite);
	const error = h("p", "share-error");
	error.hidden = true;
	error.setAttribute("role", "alert");

	const list = h("ul", "share-people");
	list.setAttribute("aria-label", "People with access");

	const bar = h("div", "cf-dialog-actions");
	const copy = h("button", "btn share-copy", "Copy link");
	copy.type = "button";
	const done = h("button", "btn", "Done");
	done.type = "button";
	bar.append(copy, done);
	dialog.append(title, note, form, error, list, bar);

	const link = target.kind === "page" ? `${location.origin}/p/${target.id}` : location.origin;

	const call = async (body: Record<string, unknown>): Promise<boolean> => {
		error.hidden = true;
		try {
			const res = await fetch(location.pathname + target.path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ kind: target.kind, id: target.id, ...body }),
			});
			if (!res.ok) {
				const { message } = (await res.json().catch(() => ({}))) as { message?: string };
				error.textContent = PROBLEMS[message ?? ""] ?? message ?? "That didn't work. Try again.";
				error.hidden = false;
				return false;
			}
			const { people } = (await res.json()) as { people: Person[] };
			draw(people);
			return true;
		} catch {
			error.textContent = "Couldn't reach cfnotes. Check your connection and try again.";
			error.hidden = false;
			return false;
		}
	};

	function draw(people: Person[]) {
		list.replaceChildren();
		if (people.length === 0) {
			list.append(h("li", "share-empty", "Only the workspace's owners can open it."));
			return;
		}
		for (const person of people) {
			const item = h("li", "share-person");
			const who = h("span", "share-who", person.email);
			who.title = person.email;
			const select = roleSelect(person.role, `Access for ${person.email}`);
			select.addEventListener(
				"change",
				() => void call({ op: "setRole", email: person.email, role: select.value }),
			);
			const remove = h("button", "btn share-remove", "Remove");
			remove.type = "button";
			remove.setAttribute("aria-label", `Stop sharing with ${person.email}`);
			remove.addEventListener("click", () => void call({ op: "remove", email: person.email }));
			item.append(who, select, remove);
			list.append(item);
		}
	}

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		invite.disabled = true;
		void call({ op: "invite", email: email.value, role: role.value }).then((ok) => {
			invite.disabled = false;
			if (ok) email.value = "";
			email.focus();
		});
	});

	copy.addEventListener("click", () => {
		void navigator.clipboard.writeText(link).then(
			() => {
				copy.textContent = "Copied";
				setTimeout(() => (copy.textContent = "Copy link"), 1500);
			},
			() => void alertDialog("Copy this link", link),
		);
	});

	const close = () => dialog.close();
	done.addEventListener("click", close);
	dialog.addEventListener("click", (event) => {
		if (event.target === dialog) close();
	});
	// Keys typed here are the dialog's, not the editor's or the page's shortcuts.
	dialog.addEventListener("keydown", (event) => event.stopPropagation());
	dialog.addEventListener("close", () => {
		dialog.remove();
		if (restore?.isConnected) restore.focus({ preventScroll: true });
	});

	draw([]);
	document.body.append(dialog);
	dialog.showModal();
	email.focus();
	void call({ op: "list" });
}

// The page's own Share button (owners only), in its header.
for (const button of document.querySelectorAll<HTMLElement>(".page-share")) {
	button.addEventListener("click", () => {
		const nav = document.querySelector<HTMLElement>("#page-nav");
		const paths = JSON.parse(nav?.dataset.actions ?? "{}") as Record<string, string>;
		const input = document.querySelector<HTMLInputElement>(".page-title");
		openShareDialog({
			kind: "page",
			id: button.dataset.pageId!,
			title: input?.value.trim() ?? "",
			path: paths.share!,
		});
	});
}
