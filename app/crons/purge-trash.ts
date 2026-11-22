import { cron } from "spacefn";

import * as Trash from "#modules/trash/trash.ts";

// Every day at 03:30 UTC: delete for good what's been in Trash longer than 30 days.
export default cron("30 3 * * *", Trash.purgeJob);
