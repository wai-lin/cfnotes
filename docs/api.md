# API and MCP server

Websites, scripts and AI agents use the workspace through a REST API at `/api/v1` and an MCP server at `/api/mcp`. The workspace stays private: every request needs a token.

## Tokens

Make one on the **API tokens** page (`/tokens`, linked in the sidebar). The token is shown only once. Send it with every request:

```sh
curl -H "Authorization: Bearer cfn_…" https://notes.example.com/api/v1/pages
```

- A token acts as the person who made it. Pages and comments it writes are recorded as theirs.
- A token stops working when its maker is taken off `ALLOWED_EMAILS`, or when anyone revokes it.
- A **read only** token can use `GET`. Anything else needs **read and write**.
- A token works only under `/api/`. A session cookie counts for nothing there, so a page open in a browser can't call the API.
- There is no CORS. Call the API from a server or a build step, never from a reader's browser, where the token would be exposed.

## REST API

Answers are JSON. Errors look like `{"error": "NotFound", "message": "No such page"}`, with the matching status code. Times are ISO strings.

| Request                                                                   | What it does                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/v1/me`                                                          | Who the token acts as, and its scope.                                                 |
| `GET /api/v1/pages?kind=page\|database\|row&database=<id>&limit=&offset=` | Pages not in Trash: all of them, or a page of them with `limit` and `offset`.         |
| `GET /api/v1/pages/:id?format=html\|markdown\|json`                       | One page: properties (if it's a row) and content. The default format is HTML.         |
| `POST /api/v1/pages`                                                      | Creates a page; answers `201` with it, as Markdown.                                   |
| `PATCH /api/v1/pages/:id`                                                 | Changes a page.                                                                       |
| `DELETE /api/v1/pages/:id`                                                | Moves a page to Trash.                                                                |
| `GET /api/v1/pages/:id/comments`                                          | The page's threads.                                                                   |
| `POST /api/v1/pages/:id/comments`                                         | `{body, thread?, quote?}`: a comment on the whole page or on quoted text, or a reply. |
| `GET /api/v1/folders`                                                     | Folders, with their paths.                                                            |
| `GET /api/v1/databases`                                                   | The databases.                                                                        |
| `GET /api/v1/databases/:id`                                               | A database's properties (types, select options), views and row count.                 |
| `GET /api/v1/databases/:id/rows`                                          | Rows with their properties (below).                                                   |
| `GET /api/v1/search?q=…&limit=&offset=`                                   | Search by title and text, as the app's quick find does, best first (20 by default).   |
| `GET /api/v1/files/<key>`                                                 | An uploaded file (images, attachments, media). Supports byte ranges.                  |

### Reading content

`format=html` gives semantic HTML:

- Headings have `id` anchors. A table of contents block links to them.
- Code is `<pre><code class="language-…">`. Mermaid diagrams are `<pre class="mermaid">`.
- Callouts are `<aside class="callout">` and toggles are `<details>`.
- Equations are left as TeX for the site to render: `<span class="math math-inline">\(…\)</span>` and `<div class="math math-display">\[…\]</div>`.
- Synced blocks are drawn with their latest content. Comment highlights are dropped.

A page also lists the pages that link to it, in `backlinks`.

`format=markdown` gives GitHub Markdown, using HTML for toggles, underline and sub/superscript. `format=json` gives the editor's saved state as it is stored.

Links to other pages and files point back at cfnotes unless you say otherwise:

- `pageUrl=/blog/{id}` sets where links to pages go. They also carry `data-page-id`, so a site can map them to slugs.
- `fileUrl=https://cdn.example.com/{key}` sets where images and files are linked. By default they point to `/api/v1/files/{key}`, which needs the token. A site can download them at build time, or serve them through its own server.

### Database rows

```
GET /api/v1/databases/:id/rows?where.Status=Published&sort=-Date&content=html&limit=50
```

- `where.<Property>=<value>`: keeps rows whose property equals the value, ignoring case. For multi-select, person and relation properties it means "contains". Checkboxes take `true` or `false`.
- `where.<Property>:<operator>=<value>`: keeps rows that pass one of the table's operators, e.g. `where.Date:on_or_after=2026-11-01` or `where.Views:gt=100`. Operators that take no value go bare: `where.Tags:empty`. Several `where` filters must all match.
  - Text, URL, email, phone, files, rollups and scripts: `contains`, `not_contains`, `is`, `is_not`, `starts_with`, `ends_with`.
  - Numbers: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`.
  - Dates, dates & times (by their day), times and automatic times: `is`, `before`, `after`, `on_or_before`, `on_or_after`, with `YYYY-MM-DD` (`HH:MM` for a time).
  - Select: `is`, `is_not`. Multi-select, person and relation (by the linked rows' titles): `contains`, `not_contains`. Checkbox: `checked`, `unchecked`.
  - Every type: `empty`, `not_empty`.
- `any.<n>.<Property>[:<operator>]=<value>`: groups of filters, numbered; a row must also match at least one group. `any.0.Status=Draft&any.1.Views:gte=500` is "a draft, or 500 views or more".
- `sort=<Property>`: sorts ascending, or `-<Property>` descending. It can repeat, or be comma-separated.
- `view=<name or id>`: starts from a view's own filters and sorts.
- `limit` (default 100, at most 1000) and `offset` page through the rows. The answer has `total` and `nextOffset`. Pages and search page the same way.
- `content=html|markdown|json` also returns each row's page content. `pageUrl` and `fileUrl` work as above.

Properties come back by name:

- Select: the option's name.
- Multi-select: a list of names.
- Dates: `YYYY-MM-DD`. Dates & times: `YYYY-MM-DDTHH:MM`, wall-clock time with no time zone. Times: `HH:MM`.
- People: emails.
- Relations: `[{id, title}]`.
- Files: `[{name, key, url}]`.
- Automatic times: ISO strings.

### Writing

`POST /api/v1/pages` takes:

```json
{
	"title": "Hello",
	"markdown": "# Hi\n\nSome **bold** text.",
	"folder": "<folder id>",
	"database": "<database id>",
	"properties": { "Status": "Draft", "Tags": ["news"], "Date": "2026-11-23" },
	"icon": "👋"
}
```

- Give `folder` for a page, or `database` for a row. With neither, the page goes at the top level.
- Instead of `markdown`, `doc` takes the editor's JSON.

`PATCH /api/v1/pages/:id` takes `title`, `icon`, `cover` (`g1` to `g6` for a gradient, an uploaded image's `/files/img/…` path or URL, or `""` to remove it), `properties`, and one of `markdown` (replaces the content), `doc`, or `append` (Markdown added at the end).

- Properties are set by name, through the same checks as the table. A select takes an option's name, and a new name adds the option. Relations take row ids, and people take emails of people on the allowlist.
- A value that doesn't fit answers `400`, naming the property.

Markdown that's understood:

- Headings (`####` and smaller become h3), lists, task lists (`- [ ]`) and quotes.
- Fenced code with a language, `---`, GitHub tables, and an image on its own line.
- Toggles as `<details><summary>…</summary>…</details>`.
- Equations as `$…$` and `$$…$$`.
- `**bold**`, `_italic_`, `~~strike~~`, `==highlight==` and `` `code` ``.
- Links. A link to `/p/<id>` becomes a page link.
- A line break inside a paragraph stays a line break.

Someone may have the page open while the API writes to it. The editor doesn't reload: if they keep typing, their next save replaces what the API wrote. Prefer `append`, and don't write to pages that are being edited.

## MCP server

`/api/mcp` speaks MCP's Streamable HTTP transport, without sessions: each `POST` is one JSON-RPC message, answered with JSON. Connect Claude Code with:

```sh
claude mcp add --transport http cfnotes https://notes.example.com/api/mcp \
	--header "Authorization: Bearer cfn_…"
```

Tools:

| Tool                                               | Does                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `search`                                           | Finds pages by words, paged with `limit` and `offset`.                                |
| `list_pages`, `list_folders`, `list_databases`     | Lists what's there; `list_pages` by kind, database or folder, paged.                  |
| `read_page`                                        | A page as Markdown, with its properties, cover, backlinks and comments.               |
| `get_database`                                     | A database's properties (options, relations, rollups, scripts) and views.             |
| `query_database`                                   | Rows filtered with `where` (values or operators) and `where_any` (OR), sorted, paged. |
| `create_page`                                      | A page or row from Markdown, with properties. _(write)_                               |
| `create_rows`, `update_rows`                       | Up to 100 rows at once, with each failure reported by index. _(write)_                |
| `create_database`                                  | A database with properties, full-page or inline in a page. _(write)_                  |
| `update_database`                                  | Title, and add, rename, convert, move or delete properties and options. _(write)_     |
| `create_view`, `update_view`, `delete_view`        | A database's views: layout, filters, sorts, grouping, dates. _(write)_                |
| `update_page`                                      | Title, icon, cover, properties, and replace or append content. _(write)_              |
| `edit_page`                                        | Changes one heading's section, or finds and replaces text; all or nothing. _(write)_  |
| `add_comment`                                      | A comment on a page or on quoted text (marked), or a reply in a thread. _(write)_     |
| `resolve_thread`, `edit_comment`, `delete_comment` | Resolves or reopens threads; edits or deletes your comments. _(write)_                |
| `trash_page`                                       | Moves a page to Trash. _(write)_                                                      |
| `move_page`                                        | Moves a page to a folder, and to a place among its pages. _(write)_                   |
| `create_folder`, `update_folder`                   | Makes, renames and nests folders. _(write)_                                           |
| `delete_folder`                                    | Deletes a folder; what's in it moves up a level. _(write)_                            |
| `list_trash`                                       | What's in Trash, and when each is deleted for good.                                   |
| `restore_page`                                     | Brings something back from Trash. _(write)_                                           |

Answers are text for the agent to read. Data also comes as `structuredContent`: lists and records as the same JSON, and pages as their Markdown and details. A list answers with an object, such as `{folders: […]}`.

A read-only token isn't offered the write tools. A request whose `Origin` isn't the app's own is refused, which guards against DNS rebinding from a browser.

## Code

- `modules/auth/tokens.ts`: tokens. `Sessions.user` answers with a token's owner on `/api/…`.
- `modules/api/api.ts`: what both the REST API and MCP do, built on the app's own modules (pages, database, comments, search).
- `modules/api/render.ts` and `markdown.ts`: the editor's saved state to HTML and Markdown, and Markdown back.
- `modules/api/sections.ts`: editing part of a page: a heading's section, or find-and-replace.
- `modules/api/organize.ts`: moving pages, folders and Trash, through the sidebar's and Trash's own functions.
- `modules/api/table-views.ts`: a database's views, by property name, through the table's own view ops.
- `modules/api/schema.ts`: making databases and changing their properties, by name, through the table's own ops.
- `modules/api/http.ts` and `mcp.ts`: the request handlers; `app/routes/api/` only wires them. MCP's tools are in `modules/api/tools/`.
- `modules/api/docs.ts`: serves this file publicly at `/docs/api` (HTML) and `/docs/api.md` (Markdown), with the app's `ORIGIN` in the examples and without this section.
