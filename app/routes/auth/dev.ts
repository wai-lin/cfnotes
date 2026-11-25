import { route } from "spacefn";

import * as Dev from "#modules/auth/dev.ts";

export default route({ POST: Dev.signIn });
