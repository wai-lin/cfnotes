import { html, raw, type Html } from "spacefn";

import { icon } from "#lib/icons.ts";
import { pageLabel } from "#lib/titles.ts";

import { DAY, RESTORE_ERRORS, TRASH_DAYS, type RestoreError } from "./trash.ts";

interface TrashItem {
	id: string;
	title: string;
	kind: string;
	database_id: string | null;
	host_id: string | null;
	database_title: string | null;
	items: number;
	archived_at: number | null;
	purgeAt: number;
}

function describe(item: TrashItem): string {
	if (item.kind === "database") {
		const rows = item.items - 1;
		const what = item.host_id ? "Inline database" : "Database";
		return `${what} · ${rows} ${rows === 1 ? "row" : "rows"}`;
	}
	if (item.database_id) return `Row in ${pageLabel(item.database_title ?? "")}`;
	return "Page";
}

/** The Trash page's body. */
export function trashView({
	items,
	now,
	notice,
	urls,
}: {
	items: readonly TrashItem[];
	now: number;
	notice: string | undefined;
	urls: Record<"restore" | "purge" | "empty", string>;
}): Html {
	const message =
		notice && Object.hasOwn(RESTORE_ERRORS, notice) ? RESTORE_ERRORS[notice as RestoreError] : "";
	return html`<article class="page">
		<header class="page-bar"></header>
		<h1 class="page-title">Trash</h1>
		<p class="trash-intro">
			Deleted pages, databases and rows stay here for ${TRASH_DAYS} days, then they're gone for
			good.
		</p>
		${message ? html`<p class="trash-notice" role="status">${message}</p>` : ""}
		${
			items.length === 0
				? html`<p class="trash-empty">Trash is empty.</p>`
				: html`<ul class="trash-list">
							${items.map((item) => {
								const days = Math.max(0, Math.ceil((item.purgeAt - now) / DAY));
								const when = new Date(item.archived_at ?? now);
								const deleted = when.toLocaleDateString("en", {
									month: "short",
									day: "numeric",
									// The year only when it isn't this one.
									...(when.getFullYear() === new Date(now).getFullYear()
										? {}
										: { year: "numeric" }),
								});
								return html`<li class="trash-item" id="trash-${item.id}" data-id="${item.id}">
									${raw(icon(item.kind === "database" ? "table" : "fileText", 18))}
									<div class="trash-main">
										<div class="trash-title">${pageLabel(item.title)}</div>
										<div class="trash-meta">
											${describe(item)} · Deleted ${deleted} · ${days}
											${days === 1 ? "day" : "days"} left
										</div>
									</div>
									<form method="post" action="${urls.restore}">
										<input type="hidden" name="id" value="${item.id}" />
										<button class="ghost trash-restore" type="submit">
											${raw(icon("arrowBackUp"))}<span>Restore</span>
										</button>
									</form>
									<form
										method="post"
										action="${urls.purge}"
										data-confirm="Delete this for good?"
										data-confirm-message="This can't be undone."
										data-confirm-label="Delete forever"
									>
										<input type="hidden" name="id" value="${item.id}" />
										<button class="ghost is-danger trash-purge" type="submit">
											${raw(icon("trash"))}<span>Delete forever</span>
										</button>
									</form>
								</li>`;
							})}
						</ul>
						<div class="trash-bar">
							<form
								method="post"
								action="${urls.empty}"
								data-confirm="Delete everything in Trash for good?"
								data-confirm-message="This can't be undone."
								data-confirm-label="Empty Trash"
							>
								<button class="ghost is-danger trash-empty-all" type="submit">Empty Trash</button>
							</form>
						</div>`
		}
	</article>`;
}
