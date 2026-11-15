-- up
CREATE TABLE folders (
	id TEXT PRIMARY KEY NOT NULL,
	parent_id TEXT REFERENCES folders (id),
	name TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX folders_parent_idx ON folders (parent_id, name);

ALTER TABLE pages ADD COLUMN folder_id TEXT REFERENCES folders (id);

CREATE INDEX pages_folder_idx ON pages (folder_id, created_at);
