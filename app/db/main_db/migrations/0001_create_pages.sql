-- up
CREATE TABLE pages (
	id TEXT PRIMARY KEY NOT NULL,
	parent_id TEXT REFERENCES pages (id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	content TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX pages_parent_idx ON pages (parent_id, created_at);

-- down
DROP TABLE pages;
