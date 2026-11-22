import { Effect } from "effect";
import { Input, route } from "spacefn";

import * as Files from "#modules/files/files.ts";

export default route({
	POST: Effect.flatMap(Input.body(Files.Body, Files.ATTACHMENT_LIMITS), ({ file }) =>
		Files.store("file", file),
	),
});
