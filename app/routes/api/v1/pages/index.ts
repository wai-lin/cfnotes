import { route } from "spacefn";

import * as Http from "#modules/api/http.ts";

export default route({ GET: Http.listPages, POST: Http.createPage });
