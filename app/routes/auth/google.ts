import { route } from "spacefn";

import * as Google from "#modules/auth/google.ts";

export default route({ GET: Google.signIn });
