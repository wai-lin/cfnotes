import { route } from "spacefn";

import * as Http from "#modules/api/http.ts";

export default route({ GET: Http.listComments, POST: Http.addComment });
