/**
 * The sidebar's actions, for every page that shows it: spread them into the
 * page's `actions`. Tree actions answer with the re-rendered tree, which the
 * client swaps into `#page-nav`. They're all an owner's: friends only see what's
 * shared with them.
 */
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { action, actionUrl, Input, redirect } from "spacefn";

import { fragment, json } from "#lib/responses.ts";
import * as Sharing from "#modules/sharing/sharing.ts";

import * as Sidebar from "./sidebar.ts";
import { navItems } from "./views.ts";

/** The tree with the current page (if the action came from one) marked. */
export const renderTree = Effect.gen(function* () {
	const { id } = yield* Input.params(Schema.Struct({ id: Schema.optional(Schema.String) }));
	const { pages, folders } = yield* Sidebar.tree;
	return navItems(folders, pages, id);
});

const treeResponse = Effect.map(renderTree, fragment);

/** Runs `handler` for owners only. */
const ownerOnly =
	<I, A, E, R>(handler: (input: I) => Effect.Effect<A, E, R>) =>
	(input: I) =>
		Effect.andThen(Sharing.requireOwner, handler(input));

export const sidebarActions = {
	create: action({
		input: Sidebar.NewItem,
		handler: ownerOnly((input) =>
			Effect.map(Sidebar.createPage(input), (id) => redirect(`/p/${id}`)),
		),
	}),
	createDatabase: action({
		input: Sidebar.NewItem,
		handler: ownerOnly((input) =>
			Effect.map(Sidebar.createDatabase(input), (id) => redirect(`/p/${id}`)),
		),
	}),
	newFolder: action({
		input: Sidebar.NewFolder,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.newFolder(input), treeResponse)),
	}),
	renameFolder: action({
		input: Sidebar.RenameFolder,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.renameFolder(input), treeResponse)),
	}),
	// The tree comes with an `x-undo` header: what `restoreFolder` needs.
	deleteFolder: action({
		input: Sidebar.FolderRef,
		handler: ownerOnly((input) =>
			Effect.gen(function* () {
				const undo = yield* Sidebar.deleteFolder(input);
				const response = yield* treeResponse;
				return HttpServerResponse.setHeader(
					response,
					"x-undo",
					encodeURIComponent(JSON.stringify(undo)),
				);
			}),
		),
	}),
	restoreFolder: action({
		input: Sidebar.FolderUndo,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.restoreFolder(input), treeResponse)),
	}),
	move: action({
		input: Sidebar.Move,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.move(input), treeResponse)),
	}),
	reorder: action({
		input: Sidebar.Reorder,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.reorder(input), treeResponse)),
	}),
	removePage: action({
		input: Sidebar.PageRef,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.removePage(input), treeResponse)),
	}),
	restorePage: action({
		input: Sidebar.RestorePage,
		handler: ownerOnly((input) => Effect.andThen(Sidebar.restorePage(input), treeResponse)),
	}),
	// Who a page or folder is shared with, from the Share dialog.
	share: action({
		input: Sharing.Op,
		handler: (input) => Effect.map(Sharing.run(input), json),
	}),
};

/** Where each is reached, relative to the page that shows the sidebar. */
export const sidebarUrls = Object.fromEntries(
	Object.keys(sidebarActions).map((name) => [name, actionUrl(name)]),
) as Record<keyof typeof sidebarActions, string>;
