# Database schema

The `main` D1 database (`MainDb`), as built by `app/db/main/migrations/0001_init.sql`.

```mermaid
erDiagram
	folders ||--o{ folders : "parent_id (subfolders)"
	folders |o--o{ pages : "folder_id (sidebar)"
	pages |o--o{ pages : "parent_id (sub-pages, cascade)"
	pages |o--o{ pages : "database_id (rows of a database)"
	pages |o--o{ pages : "host_id (inline database on a page)"
	pages |o--o{ pages : "archived_with (Trash item root)"
	pages ||--o{ page_links : "from_id (cascade)"
	pages ||--o{ page_links : "to_id (cascade)"
	pages ||--o{ row_relations : "from_id (row)"
	pages ||--o{ row_relations : "to_id (row)"

	folders {
		TEXT id PK
		TEXT parent_id FK "folders.id, null = top level"
		TEXT name
		INTEGER created_at
	}

	pages {
		TEXT id PK
		TEXT kind "page | database"
		TEXT title
		TEXT icon "emoji"
		TEXT cover "gradient id or /files/img/... path"
		TEXT content "Lexical document, JSON"
		TEXT body_text "plain text of content, for search"
		TEXT parent_id FK "pages.id, ON DELETE CASCADE"
		TEXT folder_id FK "folders.id"
		INTEGER position "order within folder or database"
		TEXT database_id FK "pages.id (logical): set on rows"
		TEXT host_id FK "pages.id (logical): set on inline databases"
		TEXT columns "databases: column definitions, JSON"
		TEXT view "databases: views, sorts, filters, JSON"
		TEXT cells "rows: values by column id, JSON"
		INTEGER archived_at "set while in Trash"
		TEXT archived_with FK "pages.id (logical): equals id on the Trash item itself"
		INTEGER created_at
		INTEGER updated_at
		TEXT created_by "email of who made it, null = unknown"
		TEXT updated_by "email of who last changed it"
	}

	page_links {
		TEXT from_id PK,FK "pages.id, ON DELETE CASCADE"
		TEXT to_id PK,FK "pages.id, ON DELETE CASCADE"
	}

	sessions {
		TEXT token_hash PK "SHA-256 of the cookie's token"
		TEXT email "who signed in"
		INTEGER expires_at "30 days after sign-in"
		INTEGER last_seen_at "refreshed at most hourly"
	}

	row_relations {
		TEXT column_id PK "relation column in the from row's database columns JSON"
		TEXT from_id PK,FK "pages.id (logical)"
		TEXT to_id PK,FK "pages.id (logical)"
		INTEGER position
	}
```

## Notes

- **`pages` holds three kinds of thing.**
  - **Pages and databases** are told apart by `kind`.
  - **Rows** are pages with `database_id` set; their values are in `cells`.
  - **Inline databases** have `host_id` set to the page that embeds them.
  - Rows and inline databases don't appear in the sidebar.
- **Real foreign keys vs. logical ones.**
  - Declared in SQL: `pages.parent_id` (cascades), `pages.folder_id`, `folders.parent_id` and both `page_links` columns (cascade).
  - Kept only by the app: `database_id`, `host_id`, `archived_with` and both `row_relations` page columns. Nothing in SQL enforces these; the app cleans them up itself.
- **Trash.**
  - Every page removed in one delete gets the same `archived_with`: a database plus its rows, or a page plus its inline databases.
  - The removed page itself is the Trash item, the row where `archived_with = id`.
  - Restore and purge act on the whole group.
- **`row_relations.column_id`** points into the `columns` JSON of the `from_id` row's database, not to a table. A two-way relation's other side reads the same links from `to_id`.
- **`page_links`** records which pages link to which. It's rebuilt from `content` on save.
- **`sessions`** is who's signed in. There is no users table: the workspace is shared by the emails in `ALLOWED_EMAILS`, which is checked on every request. A daily cron deletes ended sessions.
- **Indexes:**
  - `pages`: `(parent_id, created_at)`, `(folder_id, created_at)`, `(folder_id, position)`, `(database_id, position)`, `host_id`, `archived_at`, `archived_with`.
  - `folders`: `(parent_id, name)`.
  - `page_links`: `to_id`.
  - `row_relations`: `from_id`, `to_id`.
