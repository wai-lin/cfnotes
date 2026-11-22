import { describe, expect, it } from "vitest";

import { mermaidMessage } from "./logic.ts";

describe("mermaidMessage", () => {
	it("says the last line for an error past the end", () => {
		const error = new Error(
			"Parse error on line 4:\n...B\n-----^\nExpecting 'SPACE', 'NL', got 'EOF'",
		);
		expect(mermaidMessage(error, "flowchart TD\n  A --> B\n  B -->\n")).toBe(
			"Parse error on line 3: unexpected end of the diagram",
		);
	});

	it("names the unexpected token", () => {
		const error = new Error("Parse error on line 2:\nExpecting 'NODE_STRING', got 'ARROW_POINT'");
		expect(mermaidMessage(error, "a\nb\nc")).toBe("Parse error on line 2: unexpected arrow point");
	});

	it("keeps other errors to their first line", () => {
		expect(mermaidMessage("No diagram type detected", "x")).toBe("No diagram type detected");
	});
});
