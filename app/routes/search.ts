import { Effect } from "effect";
import { Input, route } from "spacefn";

import { json } from "#lib/responses.ts";
import * as Search from "#modules/search/search.ts";

export default route({
	GET: Input.query(Search.Query).pipe(Effect.flatMap(Search.find), Effect.map(json)),
});
