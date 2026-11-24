import { route } from "spacefn";

import * as Docs from "#modules/api/docs.ts";

export default route({ GET: Docs.get });
