-- up
ALTER TABLE pages ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

-- For existing pages, set position based on creation order per folder
UPDATE pages SET position = (
	SELECT COUNT(*) FROM pages p2 
	WHERE p2.folder_id IS pages.folder_id 
	AND (p2.created_at < pages.created_at OR (p2.created_at = pages.created_at AND p2.id < pages.id))
);

CREATE INDEX pages_folder_position_idx ON pages (folder_id, position);

-- down
DROP INDEX pages_folder_position_idx;
ALTER TABLE pages DROP COLUMN position;
