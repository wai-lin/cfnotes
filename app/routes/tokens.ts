import { Clock, Effect } from "effect";
import { action, page, redirect } from "spacefn";

import Env from "#configs/env.ts";
import { tokensView } from "#modules/api/views.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Tokens from "#modules/auth/tokens.ts";
import { sidebarActions, sidebarUrls } from "#modules/sidebar/actions.ts";
import * as Sidebar from "#modules/sidebar/sidebar.ts";
import { shell } from "#modules/workspace/views.ts";

export default page({
	loader: Effect.gen(function* () {
		return {
			origin: (yield* Env).ORIGIN,
			tokens: yield* Tokens.list,
			me: yield* Sessions.editor,
			now: yield* Clock.currentTimeMillis,
			user: yield* Sessions.requireUser,
			...(yield* Sidebar.workspace),
		};
	}),
	actions: {
		...sidebarActions,
		// Renders the page again with the new token: the only time it's shown.
		create: action({
			input: Tokens.New,
			handler: (input) => Effect.flatMap(Sessions.editor, (by) => Tokens.create(input, by)),
		}),
		revoke: action({
			input: Tokens.Revoke,
			handler: (input) => Effect.as(Tokens.revoke(input), redirect("/tokens")),
		}),
	},
	render: ({ data, actions }) =>
		shell({
			title: "API tokens",
			user: data.user,
			pages: data.pages,
			folders: data.folders,
			index: data.index,
			activeId: "tokens",
			urls: sidebarUrls,
			body: tokensView({
				origin: data.origin,
				// The new one is already in the list the loader read after it was made.
				tokens: data.tokens,
				me: data.me,
				now: data.now,
				made: actions.create.data,
				error: actions.create.error ? "Give it a name and choose its access." : undefined,
				urls: { create: actions.create.url, revoke: actions.revoke.url },
			}),
		}),
});
