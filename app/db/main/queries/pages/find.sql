-- :one
-- Finds archived pages too; callers check `archived_at`.
-- @param id string
SELECT id, title, content, created_at, updated_at, created_by, updated_by, kind, folder_id,
	database_id, host_id, archived_at, archived_with, icon, cover, locked_at
FROM pages WHERE id = :id;
