import { ARCHIVE_DAYS } from "@modules/archive";
import { icon } from "@modules/icons";
import { definePage, html, raw } from "spacefn/pages";

import { pageLabel, shell } from "./_shell";
import { actions, type loader } from "./trash.server";

const NOTICES: Record<string, string> = {
	database_archived: "That row's database is in Trash. Restore the database first.",
	not_archived: "That item isn't in Trash any more.",
};

const DAY = 24 * 60 * 60 * 1000;

function describe(item: {
	kind: string;
	database_id: string | null;
	host_id: string | null;
	database_title: string | null;
	items: number;
}): string {
	if (item.kind === "database") {
		const rows = item.items - 1;
		const what = item.host_id ? "Inline database" : "Database";
		return `${what} · ${rows} ${rows === 1 ? "row" : "rows"}`;
	}
	if (item.database_id) return `Row in ${pageLabel(item.database_title ?? "")}`;
	return "Page";
}

export default definePage<typeof loader>(({ pages, folders, index, items, notice }) => {
	const now = Date.now();
	return shell({
		title: "Trash",
		pages,
		folders,
		index,
		activeId: "trash",
		createPath: actions.create.path(),
		createDatabasePath: actions.createDatabase.path(),
		actionPaths: {
			newFolder: actions.newFolder.path(),
			renameFolder: actions.renameFolder.path(),
			deleteFolder: actions.deleteFolder.path(),
			move: actions.move.path(),
			reorder: actions.reorder.path(),
			removePage: actions.removePage.path(),
			restorePage: actions.restorePage.path(),
			restoreFolder: actions.restoreFolder.path(),
		},
		body: html`<article class="page">
			<header class="page-bar"></header>
			<h1 class="page-title">Trash</h1>
			<p class="trash-intro">
				Deleted pages, databases and rows stay here for ${ARCHIVE_DAYS} days, then they're gone for
				good.
			</p>
			${notice && NOTICES[notice] ? html`<p class="trash-notice" role="status">${NOTICES[notice]}</p>` : ""}
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
										<form method="post" action="${actions.restore.path()}">
											<input type="hidden" name="id" value="${item.id}" />
											<button class="ghost trash-restore" type="submit">
												${raw(icon("arrowBackUp"))}<span>Restore</span>
											</button>
										</form>
										<form
											method="post"
											action="${actions.purge.path()}"
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
									action="${actions.empty.path()}"
									data-confirm="Delete everything in Trash for good?"
									data-confirm-message="This can't be undone."
									data-confirm-label="Empty Trash"
								>
									<button class="ghost is-danger trash-empty-all" type="submit">Empty Trash</button>
								</form>
							</div>`
			}
		</article>`,
	});
});
