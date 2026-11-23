import { route } from "spacefn";

import * as Mcp from "#modules/api/mcp.ts";

export default route({ POST: Mcp.post, GET: Mcp.notAllowed, DELETE: Mcp.notAllowed });
