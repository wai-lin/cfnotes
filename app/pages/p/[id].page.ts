import { icon } from "@modules/icons";
import { definePage, html, raw } from "spacefn/pages";

import { pageLabel, shell } from "../_shell";
import { actions, type loader } from "./[id].server";

export default definePage<typeof loader>(
	({ page, pages, folders, backlinks, index, parent, table }) => {
		const signals = JSON.stringify({ title: page.title, doc: "", _saving: false });
		const saveDoc = `$doc = evt.detail; @post('${actions.save.path()}', {filterSignals: {include: /^doc$/}})`;
		const saveTitle = `@post('${actions.title.path()}', {filterSignals: {include: /^title$/}})`;
		const isDatabase = page.kind === "database";
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
							data-state="${page.content ?? ""}"
							data-save-path="${actions.save.path()}"
							data-link-path="${actions.linkPage.path()}"
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

		return shell({
			title: pageLabel(page.title),
			pages,
			folders,
			index,
			activeId: page.id,
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
			body: html`${cover}
				<article
					class="page${isDatabase ? " page-database" : ""}${page.icon ? " has-icon" : ""}${page.cover ? " has-cover" : ""}"
					data-db-path="${actions.dbOp.path()}"
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
						<span class="status" data-text="$_saving ? 'Saving…' : 'Saved'">Saved</span>
						<button class="ghost page-export" type="button" title="Export as PDF">
							Export PDF
						</button>
						<form method="post" action="${actions.remove.path()}">
							<button class="ghost" type="submit">Delete</button>
						</form>
					</header>
					<div
						class="page-head"
						data-icon-path="${actions.icon.path()}"
						data-cover-path="${actions.cover.path()}"
						data-page-id="${page.id}"
					>
						<button class="page-icon" type="button" aria-label="Change icon" title="Change icon">
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
				</article>`,
		});
	},
);
