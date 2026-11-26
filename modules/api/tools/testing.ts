/** For the MCP tools' tests: calling a tool as an agent would. */
import type { cfnotes } from "#lib/testing.ts";

export type Json = Record<string, any>;
export type App = ReturnType<typeof cfnotes>;

/** Calls an MCP tool with a write token: its text, parsed when it's JSON, and whether it failed. */
export async function mcp(app: App) {
	const token = await app.token("write");
	return async (name: string, args: object) => {
		const res = await app.api(token, "/api/mcp", {
			method: "POST",
			json: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
		});
		const { result } = (await res.json()) as {
			result: { content: { text: string }[]; isError?: boolean };
		};
		const text = result.content[0]!.text;
		let data: Json = {};
		try {
			data = JSON.parse(text) as Json;
		} catch {}
		return { text, data, error: result.isError === true };
	};
}

/** The id in a page tool's answer. */
export const idIn = (text: string) => /"id": "([0-9a-f-]{36})"/.exec(text)![1]!;
