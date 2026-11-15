import { describe, expect, it } from "vite-plus/test";

import { pageLinksIn } from "./links";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SELF = "33333333-3333-4333-8333-333333333333";

const link = (pageId: unknown) => ({ type: "page-link", version: 1, pageId });
const para = (...children: unknown[]) => ({ type: "paragraph", children });
const doc = (...children: unknown[]) => ({ root: { type: "root", children } });

describe("pageLinksIn", () => {
	it("finds links anywhere in the tree, once each, in order", () => {
		const state = doc(
			para({ type: "text", text: "see " }, link(B)),
			{
				type: "table",
				children: [
					{ type: "tablerow", children: [{ type: "tablecell", children: [para(link(A))] }] },
				],
			},
			para(link(B)),
		);
		expect(pageLinksIn(state)).toEqual([B, A]);
	});

	it("skips the page itself and malformed ids", () => {
		expect(pageLinksIn(doc(para(link(SELF), link("nope"), link(42), link(A))), SELF)).toEqual([A]);
	});

	it("tolerates junk", () => {
		expect(pageLinksIn(null)).toEqual([]);
		expect(pageLinksIn({})).toEqual([]);
		expect(pageLinksIn({ root: { children: "x" } })).toEqual([]);
	});
});
