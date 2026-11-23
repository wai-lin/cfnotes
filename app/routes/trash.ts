import { Effect, Schema } from "effect";
import { action, Input, page, redirect } from "spacefn";

import * as Sessions from "#modules/auth/sessions.ts";
import { sidebarActions, sidebarUrls } from "#modules/sidebar/actions.ts";
import * as Sidebar from "#modules/sidebar/sidebar.ts";
import * as Trash from "#modules/trash/trash.ts";
import { trashView } from "#modules/trash/views.ts";
import { shell } from "#modules/workspace/views.ts";

export default page({
	loader: Effect.gen(function* () {
		const { notice } = yield* Input.query(
			Schema.Struct({ notice: Schema.optional(Schema.String) }),
		);
		return {
			notice,
			user: yield* Sessions.requireUser,
			...(yield* Sidebar.workspace),
			...(yield* Trash.list),
		};
	}),
	actions: {
		...sidebarActions,
		restore: action({
			input: Trash.TrashRef,
			handler: ({ id }) =>
				Effect.map(Trash.restore(id), (result) =>
					redirect(result.ok ? `/p/${result.id}` : `/trash?notice=${result.error}`),
				),
		}),
		purge: action({
			input: Trash.TrashRef,
			handler: ({ id }) => Effect.as(Trash.purge([id]), redirect("/trash")),
		}),
		empty: action({
			input: Schema.Struct({}),
			handler: () => Effect.as(Trash.empty, redirect("/trash")),
		}),
	},
	render: ({ data, actions }) =>
		shell({
			title: "Trash",
			user: data.user,
			pages: data.pages,
			folders: data.folders,
			index: data.index,
			activeId: "trash",
			urls: sidebarUrls,
			body: trashView({
				items: data.items,
				now: data.now,
				notice: data.notice,
				urls: {
					restore: actions.restore.url,
					purge: actions.purge.url,
					empty: actions.empty.url,
				},
			}),
		}),
});
