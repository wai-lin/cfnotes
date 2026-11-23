-- New pages go to the end of their folder.
-- @param id string
-- @param title string
-- @param now number
-- @param folderId string?
-- @param by string?
INSERT INTO pages (id, folder_id, title, content, position, created_at, updated_at, created_by, updated_by)
VALUES (
	:id, :folderId, :title, NULL,
	(SELECT COALESCE(MAX(position), -1) + 1 FROM pages WHERE folder_id IS :folderId),
	:now, :now, :by, :by
);
