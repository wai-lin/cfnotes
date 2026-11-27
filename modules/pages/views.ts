import { html, raw, type Html } from "spacefn";

import { icon } from "#lib/icons.ts";
import { pageLabel } from "#lib/titles.ts";
import { hasMyanmar } from "#modules/appearance/appearance.ts";
import type { Thread } from "#modules/comments/comments.ts";
import type { DatabaseState } from "#modules/database/columns.ts";
import type { Access } from "#modules/sharing/roles.ts";

type PageUrls = Record<
	| "save"
	| "title"
	| "linkPage"
	| "dbOp"
	| "synced"
	| "comments"
	| "icon"
	| "cover"
	| "remove"
	| "lock",
	string
>;

/** A page's cover, header, title, and its editor or table. */
export function pageView({
	page,
	parent,
	table,
	backlinks,
	access = "owner",
	canTrash = access === "owner",
	lock = null,
	embed = false,
	comments,
	urls,
}: {
	page: {
		id: string;
		title: string;
		content: string | null;
		kind: string;
		icon: string | null;
		cover: string | null;
	};
	parent: { id: string; title: string } | null;
	table: DatabaseState | null;
	backlinks: readonly { id: string; title: string }[];
	/** What the reader may do: an owner anything, a friend what the page is shared with them as. */
	access?: Access;
	/** Whether Delete shows: an owner's, or a friend's who may edit where the page lives. */
	canTrash?: boolean;
	/** What locks it, nearest first: itself, what holds it, or a folder above it. */
	lock?: { kind: string; id: string | null; name: string | null } | null;
	/** Shown in a row's popup, where links open in the window around it (but Lock stays). */
	embed?: boolean;
	/** The page's threads, and who is reading (`null`: no one signed in). */
	comments: { threads: readonly Thread[]; me: string | null };
	urls: PageUrls;
}): Html {
	const signals = JSON.stringify({ title: page.title, doc: "", _saving: false, _offline: false });
	const saveDoc = `$doc = evt.detail; @post('${urls.save}', {filterSignals: {include: /^doc$/}})`;
	const saveTitle = `@post('${urls.title}', {filterSignals: {include: /^title$/}})`;
	const isDatabase = page.kind === "database";
	const canEdit = access === "owner" || access === "edit";
	// Delete moves it to Trash, and the next page offers Undo: no question.

	// Below the title: a full-page database's table, or a page's editor (with the
	// row's properties first when the page is a database row).
	const content = isDatabase
		? html`<cf-database
				data-ignore
				data-id="${page.id}"
				data-full
				data-state="${JSON.stringify(table)}"
			></cf-database>`
		: html`${
					parent
						? html`<cf-database
								data-ignore
								data-id="${parent.id}"
								data-row="${page.id}"
							></cf-database>`
						: ""
				}
				<div
					class="editor-wrap"
					data-on:notes-change="$_saving = true"
					data-on:notes-change__debounce.700ms="${saveDoc}"
				>
					<notes-editor
						data-ignore
						readonly="${canEdit ? "" : "true"}"
						state="${page.content ?? ""}"
						save-path="${urls.save}"
						link-path="${urls.linkPage}"
						synced-path="${urls.synced}"
					></notes-editor>
				</div>`;

	// The cover strip spans the pane, so it lives outside the article.
	const coverIsImage = page.cover?.startsWith("/files/") ?? false;
	const cover = html`<div
		class="page-cover${page.cover && !coverIsImage ? ` cover-${page.cover}` : ""}${page.cover ? "" : " is-empty"}"
		style="${coverIsImage ? `background-image:url(${JSON.stringify(page.cover)})` : ""}"
	>
		<div class="cover-actions">
			<button class="cover-change" type="button">Change cover</button>
			<button class="cover-remove" type="button">Remove</button>
		</div>
	</div>`;

	return html`${cover}
		<article
			class="page${isDatabase ? " page-database" : ""}${page.icon ? " has-icon" : ""}${page.cover ? " has-cover" : ""}${hasMyanmar(page.title, page.content) ? " has-myanmar" : ""}"
			data-db-path="${urls.dbOp}"
			data-access="${access}"
			data-signals="${signals}"
			data-effect="document.title = ($title.trim() || 'Untitled') + ' · cfnotes'"
		>
			<header class="page-bar">
				${
					parent
						? html`<a class="crumb" href="/p/${parent.id}"
								>${raw(icon("table"))}<span>${pageLabel(parent.title)}</span></a
							>`
						: ""
				}
				${
					canEdit
						? html`<span
								class="status"
								data-text="$_saving ? 'Saving…' : $_offline ? 'Saved offline' : 'Saved'"
								>Saved</span
							>`
						: html`<span class="page-access"
								>${access === "comment" ? "Can comment" : "View only"}</span
							>`
				}
				${
					lock
						? html`<span
								class="page-access page-locked"
								title="${
									lock.id === page.id
										? "Locked: only an owner can change it"
										: `Locked by ${lock.kind === "folder" ? "the folder" : ""} “${lock.name || "Untitled"}”`
								}"
								>${raw(icon("lock", 12))} Locked</span
							>`
						: ""
				}
				<cf-comments
					data-ignore
					data-can="${access}"
					data-path="${urls.comments}"
					data-me="${comments.me ?? ""}"
					data-state="${JSON.stringify(comments.threads)}"
				></cf-comments>
				${
					access === "owner"
						? html`<button class="ghost page-share" type="button" data-page-id="${page.id}">
								Share
							</button>`
						: ""
				}
				${
					access === "owner" && (!lock || lock.id === page.id)
						? html`<form
								method="post"
								action="${embed ? `?embed=1&${urls.lock.slice(1)}` : urls.lock}"
								target="_self"
							>
								<input type="hidden" name="locked" value="${lock ? "false" : "true"}" />
								<button
									class="ghost"
									type="submit"
									title="${lock ? "Let the people it's shared with change it again" : "Stop the people it's shared with from changing it"}"
								>
									${lock ? "Unlock" : "Lock"}
								</button>
							</form>`
						: ""
				}
				<button class="ghost page-export" type="button" title="Export as PDF">Export PDF</button>
				${
					canTrash
						? html`<form method="post" action="${urls.remove}">
								<button class="ghost" type="submit">Delete</button>
							</form>`
						: ""
				}
			</header>
			<div
				class="page-head"
				data-icon-path="${urls.icon}"
				data-cover-path="${urls.cover}"
				data-page-id="${page.id}"
			>
				<button
					class="page-icon"
					type="button"
					aria-label="Change icon"
					title="Change icon"
					${canEdit ? "" : raw("disabled")}
				>
					${page.icon ?? ""}
				</button>
				<div class="page-adders">
					<button class="page-add-icon" type="button">
						${raw(icon("moodSmile", 14))}<span>Add icon</span>
					</button>
					<button class="page-add-cover" type="button">
						${raw(icon("photo", 14))}<span>Add cover</span>
					</button>
				</div>
			</div>
			<input
				class="page-title"
				placeholder="Untitled"
				maxlength="200"
				${canEdit ? "" : raw("readonly")}
				aria-label="${isDatabase ? "Database title" : "Page title"}"
				data-bind:title
				data-on:input__debounce.400ms="${saveTitle}"
				data-on:keydown="evt.key === 'Enter' && (evt.preventDefault(), document.querySelector('notes-editor')?.focus())"
			/>
			${content}
			${
				backlinks.length > 0
					? html`<section class="backlinks" aria-label="Linked from">
							<h2 class="backlinks-title">Linked from ${backlinks.length}</h2>
							${backlinks.map(
								(link) =>
									html`<a class="backlink" href="/p/${link.id}"
										>${raw(icon("fileText"))}<span>${pageLabel(link.title)}</span></a
									>`,
							)}
						</section>`
					: ""
			}
		</article>`;
}
