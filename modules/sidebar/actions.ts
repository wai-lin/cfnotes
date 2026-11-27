/**
 * The sidebar's actions, for every page that shows it: spread them into the
 * page's `actions`. Tree actions answer with the re-rendered tree, which the
 * client swaps into `#page-nav`. A friend may make and change things only in
 * the folders shared with them to edit: `sidebar.ts` checks each.
 */
import { Effect, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { action, actionUrl, Input, redirect } from "spacefn";

import { fragment, json } from "#lib/responses.ts";
import * as Locks from "#modules/sharing/locks.ts";
import * as Sharing from "#modules/sharing/sharing.ts";

import * as Sidebar from "./sidebar.ts";
import { navItems } from "./views.ts";

/** The tree as the signed-in person sees it, with the current page (if the action came from one) marked. */
export const renderTree = Effect.gen(function* () {
	const { id } = yield* Input.params(Schema.Struct({ id: Schema.optional(Schema.String) }));
	const { pages, folders, guest, editable } = yield* Sharing.workspace;
	return navItems(folders, pages, id, { guest, editable: new Set(editable) });
});

const treeResponse = Effect.map(renderTree, fragment);

export const sidebarActions = {
	create: action({
		input: Sidebar.NewItem,
		handler: (input) => Effect.map(Sidebar.createPage(input), (id) => redirect(`/p/${id}`)),
	}),
	createDatabase: action({
		input: Sidebar.NewItem,
		handler: (input) => Effect.map(Sidebar.createDatabase(input), (id) => redirect(`/p/${id}`)),
	}),
	newFolder: action({
		input: Sidebar.NewFolder,
		handler: (input) => Effect.andThen(Sidebar.newFolder(input), treeResponse),
	}),
	renameFolder: action({
		input: Sidebar.RenameFolder,
		handler: (input) => Effect.andThen(Sidebar.renameFolder(input), treeResponse),
	}),
	// The tree comes with an `x-undo` header: what `restoreFolder` needs.
	deleteFolder: action({
		input: Sidebar.FolderRef,
		handler: (input) =>
			Effect.gen(function* () {
				const undo = yield* Sidebar.deleteFolder(input);
				const response = yield* treeResponse;
				return HttpServerResponse.setHeader(
					response,
					"x-undo",
					encodeURIComponent(JSON.stringify(undo)),
				);
			}),
	}),
	restoreFolder: action({
		input: Sidebar.FolderUndo,
		handler: (input) => Effect.andThen(Sidebar.restoreFolder(input), treeResponse),
	}),
	move: action({
		input: Sidebar.Move,
		handler: (input) => Effect.andThen(Sidebar.move(input), treeResponse),
	}),
	reorder: action({
		input: Sidebar.Reorder,
		handler: (input) => Effect.andThen(Sidebar.reorder(input), treeResponse),
	}),
	removePage: action({
		input: Sidebar.PageRef,
		handler: (input) => Effect.andThen(Sidebar.removePage(input), treeResponse),
	}),
	restorePage: action({
		input: Sidebar.RestorePage,
		handler: (input) => Effect.andThen(Sidebar.restorePage(input), treeResponse),
	}),
	// An owner's: what the people it's shared with may no longer change.
	lock: action({
		input: Locks.Lock,
		handler: (input) => Effect.andThen(Locks.setLock(input), treeResponse),
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
