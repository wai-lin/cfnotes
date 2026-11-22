/** The whole app in memory, and the requests its browser code makes. For tests. */
import { Layer } from "effect";
import { memoryServices, testApp, testDb, testEnv } from "spacefn/testing";

import Env from "#configs/env.ts";
import MainDb from "#space/db/main.ts";
import { manifest } from "#space/manifest.ts";

export function cfnotes() {
	const app = testApp(
		manifest,
		Layer.mergeAll(testDb(MainDb), memoryServices, Env.layer.pipe(Layer.provide(testEnv({})))),
	);
	return {
		fetch: app.fetch,
		/** A page action called with JSON, as the browser code and Datastar's `@post` do. */
		post: (path: string, action: string, body: unknown) =>
			app.fetch(`${path}?__action=${action}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		/** Opens the workspace: the first page's path and id. */
		async open() {
			const path = (await app.fetch("/")).headers.get("location")!;
			return { path, id: path.split("/").pop()! };
		},
		[Symbol.asyncDispose]: app.dispose,
	};
}
