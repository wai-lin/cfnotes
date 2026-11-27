import { describe, expect, it } from "vitest";

import { mentionEmail, MENTION_TRIGGER, rankPeople } from "./logic.ts";

const people = [
	{ email: "owner@example.com", name: "owner" },
	{ email: "ana@example.com", name: "ana" },
	{ email: "banana@example.com", name: "banana" },
];

describe("mentions", () => {
	it("opens after a space or at the start, not inside an email", () => {
		expect(MENTION_TRIGGER.pattern.exec("hi @an")?.[1]).toBe("an");
		expect(MENTION_TRIGGER.pattern.exec("@")?.[1]).toBe("");
		expect(MENTION_TRIGGER.pattern.exec("mail me@ex")).toBeNull();
	});

	it("ranks names starting with the query first", () => {
		expect(rankPeople(people, "an").map((p) => p.name)).toEqual(["ana", "banana"]);
		expect(rankPeople(people, "").length).toBe(3);
	});

	it("reads a mention's email from its link", () => {
		expect(mentionEmail("mailto:ana@example.com", "@ana")).toBe("ana@example.com");
		expect(mentionEmail("mailto:ana@example.com", "write to Ana")).toBeNull();
		expect(mentionEmail("https://example.com", "@ana")).toBeNull();
	});
});
