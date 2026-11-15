import { migrated } from "@space/db/main_db";
import { d1Executor } from "spacefn/db";

/** Returns a D1 executor once the schema is migrated (cached per isolate). */
export async function database(d1: D1Database) {
	await migrated(d1);
	return d1Executor(d1);
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPageId(value: string | undefined): value is string {
	return typeof value === "string" && ID_PATTERN.test(value);
}

/** Largest serialized editor state accepted on save (D1 rows max out at 2 MB). */
export const MAX_CONTENT_BYTES = 1_000_000;
export const MAX_TITLE_LENGTH = 200;
