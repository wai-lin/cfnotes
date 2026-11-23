import { describe, expect, it } from "vitest";

import { fromMarkdown, parseInline } from "./markdown.ts";
import { slug, toHtml, toMarkdown, type Refs } from "./render.ts";

const PAGE = "0b8a9a3e-8d5e-4f7e-9c51-2a4c8f1d3e70";

const refs: Refs = {
	titles: { [PAGE]: "Other page" },
	synced: {},
	pageHref: (id) => `/blog/${id}`,
	fileHref: (path) => `https://cdn.test${path}`,
};

const SAMPLE = `# Title

Some **bold**, _italic_, ~~gone~~, \`code\` and a [link](https://example.com).\\
A second line, and [Other page](/p/${PAGE}).

## Lists

- one
- two
  - nested

- [ ] task
- [x] done

1. first
2. second

> A quote

\`\`\`ts
const a = 1;
const b = 2;
\`\`\`

---

| A | B |
| --- | --- |
| 1 | 2 |

![A cat](/files/img/1b8a9a3e-8d5e-4f7e-9c51-2a4c8f1d3e70.png "The cat")

$$
e = mc^2
$$

<details>
<summary>More</summary>

Hidden text

</details>`;

describe("markdown and the editor's documents", () => {
	it("turns Markdown into the editor's nodes", () => {
		const { root } = fromMarkdown(SAMPLE);
		const types = (root.children as { type: string }[]).map((n) => n.type);
		expect(types).toEqual([
			"heading",
			"paragraph",
			"heading",
			"list",
			"list",
			"list",
			"quote",
			"code",
			"divider",
			"table",
			"image",
			"equation",
			"toggle",
		]);
		const inline = parseInline(`a **b** [c](/p/${PAGE}) snake_case_name`);
		expect(inline).toMatchObject([
			{ type: "text", text: "a " },
			{ type: "text", text: "b", format: 1 },
			{ type: "text", text: " " },
			{ type: "page-link", pageId: PAGE },
			{ type: "text", text: " snake_case_name" },
		]);
	});

	it("comes back to the same Markdown", () => {
		const md = toMarkdown(fromMarkdown(SAMPLE), {
			...refs,
			pageHref: (id) => `/p/${id}`,
			fileHref: (path) => path,
		});
		expect(md).toBe(SAMPLE);
	});

	it("renders HTML with anchors, safe links and the reader's URLs", () => {
		const html = toHtml(
			fromMarkdown(
				`# Hello world\n\n[x](javascript:alert(1)) [y](/p/${PAGE})\n\n![a](/files/img/x.png)\n\n# Hello world\n\n<script>no</script>`,
			),
			refs,
		);
		expect(html).toContain('<h1 id="hello-world">Hello world</h1>');
		expect(html).toContain('<h1 id="hello-world-1">');
		expect(html).not.toContain("javascript:");
		expect(html).toContain(`<a href="/blog/${PAGE}" data-page-id="${PAGE}">Other page</a>`);
		expect(html).toContain('<img src="https://cdn.test/files/img/x.png" alt="a">');
		expect(html).toContain("&lt;script&gt;");
	});

	it("slugs headings", () => {
		expect(slug("Héllo, World!")).toBe("hello-world");
		expect(slug("…")).toBe("section");
	});
});
