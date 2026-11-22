import { Effect } from "effect";
import { Input, route } from "spacefn";

import * as Unfurl from "#modules/unfurl/unfurl.ts";

export default route({ GET: Effect.flatMap(Input.query(Unfurl.Query), Unfurl.unfurl) });
