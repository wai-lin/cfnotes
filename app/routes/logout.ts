import { route } from "spacefn";

import * as Sessions from "#modules/auth/sessions.ts";

export default route({ POST: Sessions.signOut });
