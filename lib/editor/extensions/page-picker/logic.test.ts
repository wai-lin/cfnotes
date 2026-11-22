import { describe, expect, it } from "vitest";

import { choiceLabel, MAX_RESULTS, pickerChoices, PICKER_TRIGGER, rankPages } from "./logic.ts";

const pages = [
	{ id: "1", title: "Roadmap" },
	{ id: "2", title: "Meeting notes" },
	{ id: "3", title: "Notes on roads" },
	{ id: "4", title: "Groceries" },
];

describe("rankPages", () => {
	it("puts titles starting with the query before ones containing it", () => {
		expect(rankPages(pages, "road").map((p) => p.id)).toEqual(["1", "3"]);
		expect(rankPages(pages, " NOTES ").map((p) => p.id)).toEqual(["3", "2"]);
	});

	it("lists the first pages for an empty query", () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `Page ${i}` }));
		expect(rankPages(many, "")).toHaveLength(MAX_RESULTS);
	});
});

describe("pickerChoices", () => {
	it("leaves out the current page and offers a new one", () => {
		const choices = pickerChoices(pages, "road  map", "1", true);
		expect(choices).toEqual([{ kind: "new", title: "road map" }]);
		expect(choiceLabel(choices[0]!)).toBe("New page “road map”");
	});

	it("offers no new page when pages can't be made", () => {
		expect(pickerChoices(pages, "groc", null, false)).toEqual([
			{ kind: "page", id: "4", title: "Groceries" },
		]);
	});
});

describe("PICKER_TRIGGER", () => {
	it("opens after [[ and stops at brackets or newlines", () => {
		expect(PICKER_TRIGGER.pattern.exec("see [[road")?.[1]).toBe("road");
		expect(PICKER_TRIGGER.pattern.exec("see [[a]b")).toBeNull();
	});
});
