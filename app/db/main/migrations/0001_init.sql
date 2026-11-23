-- up
CREATE TABLE folders (
	id TEXT PRIMARY KEY NOT NULL,
	parent_id TEXT REFERENCES folders (id),
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX folders_parent_idx ON folders (parent_id, name);

-- kind: 'page' or 'database'. A database keeps its column definitions in
-- `columns` and its table view settings (sorts and filters) in `view`, both
-- JSON. Its rows are pages with `database_id` set and their values in `cells`
-- (JSON). An inline database has `host_id` set to the page that embeds it.
-- Rows and inline databases stay out of the sidebar.
--
-- Archived pages are hidden everywhere and deleted for good after a while.
-- `archived_with` is the page whose removal archived this one (itself for the
-- thing that was removed), so a database comes back together with its rows.
--
-- `icon` is an emoji; `cover` is a preset gradient id (`g1`…) or the path of an
-- uploaded image (`/files/img/…`). `body_text` is the plain text of the page's
-- document, for search; the app keeps it in step on save.
CREATE TABLE pages (
	id TEXT PRIMARY KEY NOT NULL,
	parent_id TEXT REFERENCES pages (id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	content TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	folder_id TEXT REFERENCES folders (id),
	position INTEGER NOT NULL DEFAULT 0,
	kind TEXT NOT NULL DEFAULT 'page',
	database_id TEXT,
	host_id TEXT,
	columns TEXT,
	cells TEXT,
	view TEXT,
	archived_at INTEGER,
	archived_with TEXT,
	icon TEXT,
	cover TEXT,
	body_text TEXT
);

CREATE INDEX pages_parent_idx ON pages (parent_id, created_at);
CREATE INDEX pages_folder_idx ON pages (folder_id, created_at);
CREATE INDEX pages_folder_position_idx ON pages (folder_id, position);
CREATE INDEX pages_database_idx ON pages (database_id, position);
CREATE INDEX pages_host_idx ON pages (host_id);
CREATE INDEX pages_archived_idx ON pages (archived_at);
CREATE INDEX pages_archived_with_idx ON pages (archived_with);

CREATE TABLE page_links (
	from_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
	to_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
	PRIMARY KEY (from_id, to_id)
) WITHOUT ROWID;

CREATE INDEX page_links_to_idx ON page_links (to_id);

-- Links made by relation columns. `column_id` is the relation column that owns
-- the link (in the database of `from_id`); a two-way relation's other side
-- reads the same rows from `to_id`.
CREATE TABLE row_relations (
	column_id TEXT NOT NULL,
	from_id TEXT NOT NULL,
	to_id TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (column_id, from_id, to_id)
) WITHOUT ROWID;

CREATE INDEX row_relations_from_idx ON row_relations (from_id);
CREATE INDEX row_relations_to_idx ON row_relations (to_id);

-- Who is signed in. Only a hash of the cookie's token is stored.
CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY NOT NULL,
	email TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL
) WITHOUT ROWID;

-- down
DROP TABLE sessions;
DROP TABLE row_relations;
DROP TABLE page_links;
DROP TABLE pages;
DROP TABLE folders;
