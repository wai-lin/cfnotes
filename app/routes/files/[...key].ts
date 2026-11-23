import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { Input, route } from "spacefn";

import * as Files from "#modules/files/files.ts";

export default route({
	GET: Effect.gen(function* () {
		const { key } = yield* Input.params(Files.Key);
		const { name } = yield* Input.query(Files.Download);
		const { headers } = yield* HttpServerRequest.HttpServerRequest;
		return yield* Files.serve(key, name, headers.range);
	}),
});
