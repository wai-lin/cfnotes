-- New rows go to the end of the database.
-- @param id string
-- @param databaseId string
-- @param title string
-- @param now number
-- @param by string?
INSERT INTO pages (id, database_id, title, cells, position, created_at, updated_at, created_by, updated_by)
VALUES (
	:id, :databaseId, :title, '{}',
	(SELECT COALESCE(MAX(position), -1) + 1 FROM pages WHERE database_id = :databaseId),
	:now, :now, :by, :by
);
