/** What an MCP tool is, and the helpers the tools share for their schemas and answers. */
import type { Effect } from "effect";

export type Json = Record<string, unknown>;

export interface Tool {
	name: string;
	title: string;
	description: string;
	inputSchema: Json;
	annotations: Json;
	/** Needs a token that may write. */
	write?: boolean;
	run: (args: Record<string, unknown>) => Effect.Effect<Answer, unknown, any>;
}

/** Text the agent reads, and the same as data (MCP's `structuredContent`). */
export interface Rich {
	readonly _tag: "Rich";
	readonly text: string;
	readonly structured: Json;
}

/**
 * What a tool answers with: a message, data (sent as JSON text and as
 * `structuredContent`), or text with its data beside it.
 */
export type Answer = string | Json | Rich;

export const rich = (text: string, structured: Json): Rich => ({ _tag: "Rich", text, structured });

/** An answer as MCP sends it. */
export const toResult = (answer: Answer | undefined | null) => {
	if (typeof answer === "string") return { content: [{ type: "text", text: answer }] };
	if (!answer) return { content: [{ type: "text", text: "null" }] };
	if (answer._tag === "Rich")
		return { content: [{ type: "text", text: answer.text }], structuredContent: answer.structured };
	return { content: [{ type: "text", text: json(answer) }], structuredContent: answer };
};

export const string = (description: string): Json => ({ type: "string", description });
export const integer = (description: string, minimum = 0, maximum?: number): Json => ({
	type: "integer",
	minimum,
	...(maximum === undefined ? {} : { maximum }),
	description,
});
export const boolean = (description: string): Json => ({ type: "boolean", description });
export const array = (items: Json, description: string): Json => ({
	type: "array",
	items,
	description,
});
export const enumOf = (values: readonly string[], description: string): Json => ({
	type: "string",
	enum: values,
	description,
});

export const pageId = string("The page's id (a UUID).");
export const databaseId = string("The database's id.");

export const object = (props: Json, required: string[] = []): Json => ({
	type: "object",
	properties: props,
	required,
	additionalProperties: false,
});

export const readOnly: Json = { readOnlyHint: true, openWorldHint: false };
/** Writes that add things. */
export const adds: Json = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
/** Writes that change or remove what's there. */
export const changes: Json = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};

export const json = (value: unknown) => JSON.stringify(value, null, 2);
export const str = (value: unknown) => (typeof value === "string" ? value : undefined);
export const record = (value: unknown) =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** How content links to pages, for an agent: relative, so it can write them back. */
export const MARKDOWN_LINKS = { format: "markdown" as const, pageUrl: "/p/{id}" };
