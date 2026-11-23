import { csrf } from "spacefn";

import { signedInOnly } from "#modules/auth/guard.ts";
import { COOKIE } from "#modules/auth/sessions.ts";

// Refuses cross-site posts, then anyone who isn't signed in (modules/auth/guard.ts lists what's public).
export default [csrf({ cookie: COOKIE }), signedInOnly];
