import { Effect, Schema } from "effect";
import { action, Datastar, Input, page, redirect } from "spacefn";

import { json } from "#lib/responses.ts";
import { pageLabel } from "#lib/titles.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Comments from "#modules/comments/comments.ts";
import * as Database from "#modules/database/database.ts";
import * as Pages from "#modules/pages/pages.ts";
import { pageView } from "#modules/pages/views.ts";
import * as Sharing from "#modules/sharing/sharing.ts";
import { renderTree, sidebarActions, sidebarUrls } from "#modules/sidebar/actions.ts";
import { navLink } from "#modules/sidebar/views.ts";
import * as Synced from "#modules/synced/synced.ts";
import { shell } from "#modules/workspace/views.ts";

// /p/:id
const id = Effect.map(Input.params(Pages.Params), (params) => params.id);

export default page({
	loader: Effect.gen(function* () {
		const view = yield* Pages.view(yield* id);
		if (!view) return redirect(yield* Pages.goneTo, 302);
		return {
			...view,
			threads: yield* Comments.threads(view.page.id),
			me: yield* Sessions.editor,
			user: yield* Sessions.requireUser,
			...(yield* Sharing.workspace),
		};
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
		// The latest content of synced blocks, and saving it.
		synced: action({
			input: Synced.Op,
			limits: Synced.SYNCED_LIMITS,
			handler: (op) =>
				Effect.gen(function* () {
					return json(yield* Synced.run(yield* id, op));
				}),
		}),
		// Threads of comments on this page.
		comments: action({
			input: Comments.Op,
			handler: (op) =>
				Effect.gen(function* () {
					return json(yield* Comments.run(yield* id, op));
				}),
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
			user: data.user,
			pages: data.pages,
			folders: data.folders,
			index: data.index,
			guest: data.guest,
			editable: data.editable,
			activeId: data.page.id,
			urls: sidebarUrls,
			body: pageView({
				page: data.page,
				parent: data.parent,
				table: data.table,
				backlinks: data.backlinks,
				access: data.access,
				canTrash: data.canTrash,
				comments: { threads: data.threads, me: data.me },
				urls: {
					save: actions.save.url,
					title: actions.title.url,
					linkPage: actions.linkPage.url,
					dbOp: actions.dbOp.url,
					synced: actions.synced.url,
					comments: actions.comments.url,
					icon: actions.icon.url,
					cover: actions.cover.url,
					remove: actions.remove.url,
				},
			}),
		}),
});
