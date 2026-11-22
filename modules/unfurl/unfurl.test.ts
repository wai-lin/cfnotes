import { describe, expect, it } from "vitest";

import { cfnotes } from "#lib/testing.ts";

describe("/unfurl", () => {
	it.each(["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/", "nonsense"])(
		"won't fetch %s",
		async (url) => {
			await using app = cfnotes();
			const res = await app.fetch(`/unfurl?url=${encodeURIComponent(url)}`);
			expect(res.status).toBe(400);
		},
	);
});
