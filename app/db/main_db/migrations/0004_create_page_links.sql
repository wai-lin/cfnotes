-- up
CREATE TABLE page_links (
	from_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
	to_id TEXT NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
	PRIMARY KEY (from_id, to_id)
) WITHOUT ROWID;

CREATE INDEX page_links_to_idx ON page_links (to_id);

-- down
DROP TABLE page_links;
