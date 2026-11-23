-- @param id string
-- @param title string
-- @param columns string
-- @param now number
-- @param folderId string?
-- @param hostId string?
-- @param by string?
INSERT INTO pages (id, folder_id, host_id, kind, title, columns, position, created_at, updated_at, created_by, updated_by)
VALUES (
	:id, :folderId, :hostId, 'database', :title, :columns,
	(SELECT COALESCE(MAX(position), -1) + 1 FROM pages WHERE folder_id IS :folderId),
	:now, :now, :by, :by
);
