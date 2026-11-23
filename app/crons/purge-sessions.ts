import { cron } from "spacefn";

import * as Sessions from "#modules/auth/sessions.ts";

// With the Trash purge, so the account uses one Cron Trigger.
export default cron("30 3 * * *", Sessions.purgeJob);
