import { Schema } from "effect";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The id of a page, database, row or folder: a UUID. */
export const Id = Schema.String.check(Schema.isPattern(ID_PATTERN));

export const isId = (value: unknown): value is string =>
	typeof value === "string" && ID_PATTERN.test(value);
