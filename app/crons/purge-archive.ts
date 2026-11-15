import { defineCron } from "spacefn/crons";

/** Every day at 03:30 UTC: delete for good what's been archived longer than 30 days. */
export default defineCron("30 3 * * *", async (_event, env) => {
	// Loaded here, not at the top: the build reads this file's schedule before
	// the `@modules` aliases exist, so the file must import nothing else up front.
	const [{ purgeExpired }, { database }] = await Promise.all([
		import("@modules/archive"),
		import("@modules/db"),
	]);
	const count = await purgeExpired(await database((env as { DB: D1Database }).DB));
	if (count > 0) console.log(`purged ${count} archived item(s)`);
});
