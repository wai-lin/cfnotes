import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { redirect, route } from "spacefn";

import * as Sidebar from "#modules/sidebar/sidebar.ts";

export default route({
	GET: Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const id = yield* Sidebar.firstPage;
		// Keep the query: a redirect here after trashing carries the toast's details.
		const { search } = new URL(request.originalUrl, "http://localhost");
		return redirect(`/p/${id}${search}`, 302);
	}),
});
