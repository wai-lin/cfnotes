-- :one
-- Finds archived pages too; callers check `archived_at`.
-- @param id string
SELECT id, title, content, updated_at, kind, database_id, host_id, archived_at, archived_with, icon, cover
FROM pages WHERE id = :id;
