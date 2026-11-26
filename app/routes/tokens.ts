import { Clock, Effect } from "effect";
import { action, page, redirect } from "spacefn";

import Env from "#configs/env.ts";
import { tokensView } from "#modules/api/views.ts";
import * as Sessions from "#modules/auth/sessions.ts";
import * as Tokens from "#modules/auth/tokens.ts";
import * as Sharing from "#modules/sharing/sharing.ts";
import { sidebarActions, sidebarUrls } from "#modules/sidebar/actions.ts";
import { shell } from "#modules/workspace/views.ts";

/** Who is signed in, as the tokens see them. */
const manager = Effect.map(Sharing.me, (who) => who ?? { email: "", owner: false });

/** Why a token wasn't made, in words. */
const createProblem = (error: unknown) =>
	(error as { _tag?: unknown })._tag === "BadRequest" &&
	String((error as { message?: unknown }).message).startsWith("You can have")
		? String((error as { message: string }).message)
		: "Give it a name and choose its access.";

export default page({
	loader: Effect.gen(function* () {
		return {
			origin: (yield* Env).ORIGIN,
			tokens: yield* Tokens.list(yield* manager),
			me: yield* Sessions.editor,
			now: yield* Clock.currentTimeMillis,
			user: yield* Sessions.requireUser,
			...(yield* Sharing.workspace),
		};
	}),
	actions: {
		...sidebarActions,
		// Renders the page again with the new token: the only time it's shown.
		create: action({
			input: Tokens.New,
			handler: (input) => Effect.flatMap(manager, (who) => Tokens.create(input, who)),
		}),
		revoke: action({
			input: Tokens.Revoke,
			handler: (input) =>
				Effect.as(
					Effect.flatMap(manager, (who) => Tokens.revoke(input, who)),
					redirect("/tokens"),
				),
		}),
	},
	render: ({ data, actions }) =>
		shell({
			title: "API tokens",
			user: data.user,
			pages: data.pages,
			folders: data.folders,
			index: data.index,
			guest: data.guest,
			editable: data.editable,
			activeId: "tokens",
			urls: sidebarUrls,
			body: tokensView({
				guest: data.guest,
				origin: data.origin,
				// The new one is already in the list the loader read after it was made.
				tokens: data.tokens,
				me: data.me,
				now: data.now,
				made: actions.create.data,
				error: actions.create.error ? createProblem(actions.create.error) : undefined,
				urls: { create: actions.create.url, revoke: actions.revoke.url },
			}),
		}),
});
