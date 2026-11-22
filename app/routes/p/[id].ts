import { Effect, Schema } from "effect";
import { action, Datastar, Input, page, redirect } from "spacefn";

import { json } from "#lib/responses.ts";
import { pageLabel } from "#lib/titles.ts";
import * as Database from "#modules/database/database.ts";
import * as Pages from "#modules/pages/pages.ts";
import { pageView } from "#modules/pages/views.ts";
import { renderTree, sidebarActions, sidebarUrls } from "#modules/sidebar/actions.ts";
import * as Sidebar from "#modules/sidebar/sidebar.ts";
import { navLink } from "#modules/sidebar/views.ts";
import { shell } from "#modules/workspace/views.ts";

// /p/:id
const id = Effect.map(Input.params(Pages.Params), (params) => params.id);

export default page({
	loader: Effect.gen(function* () {
		const view = yield* Pages.view(yield* id);
		if (!view) return redirect("/trash", 302);
		return { ...view, ...(yield* Sidebar.workspace) };
	}),
	actions: {
		...sidebarActions,
		linkPage: action({
			input: Pages.NewLinked,
			handler: (input) =>
				Effect.gen(function* () {
					const made = yield* Pages.createLinked(yield* id, input);
					return json({ ...made, tree: (yield* renderTree).value });
				}),
		}),
		// Datastar: rename, then patch the sidebar link. The tab title follows `$title`.
		title: action({
			input: Pages.Title,
			handler: (input) =>
				Effect.gen(function* () {
					const pageId = yield* id;
					const link = yield* Pages.rename(pageId, input);
					return yield* Datastar.sse(link ? [Datastar.patchElements(navLink(link, pageId))] : []);
				}),
		}),
		icon: action({
			input: Pages.Icon,
			handler: (input) =>
				Effect.gen(function* () {
					const pageId = yield* id;
					const link = yield* Pages.setIcon(pageId, input);
					return json({ ok: true, nav: link ? navLink(link, pageId).value : undefined });
				}),
		}),
		cover: action({
			input: Pages.Cover,
			handler: (input) =>
				Effect.gen(function* () {
					return json({ ok: true, cover: yield* Pages.setCover(yield* id, input) });
				}),
		}),
		// Datastar: store the serialized editor state.
		save: action({
			input: Pages.Save,
			limits: Pages.SAVE_LIMITS,
			handler: (input) =>
				Effect.gen(function* () {
					yield* Pages.save(yield* id, input);
					return yield* Datastar.sse([Datastar.patchSignals({ _saving: false })]);
				}),
		}),
		remove: action({
			input: Schema.Struct({}),
			handler: () => Effect.map(Effect.flatMap(id, Pages.remove), (to) => redirect(to)),
		}),
		dbOp: action({
			input: Database.Op,
			limits: Database.OP_LIMITS,
			handler: (op) =>
				Effect.gen(function* () {
					return json(yield* Database.runOp(yield* id, op));
				}),
		}),
	},
	render: ({ data, actions }) =>
		shell({
			title: pageLabel(data.page.title),
			pages: data.pages,
			folders: data.folders,
			index: data.index,
			activeId: data.page.id,
			urls: sidebarUrls,
			body: pageView({
				page: data.page,
				parent: data.parent,
				table: data.table,
				backlinks: data.backlinks,
				urls: {
					save: actions.save.url,
					title: actions.title.url,
					linkPage: actions.linkPage.url,
					dbOp: actions.dbOp.url,
					icon: actions.icon.url,
					cover: actions.cover.url,
					remove: actions.remove.url,
				},
			}),
		}),
});
