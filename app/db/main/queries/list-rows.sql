-- @param databaseId string
SELECT id, title, cells, icon, cover FROM pages
WHERE database_id = :databaseId AND archived_at IS NULL
ORDER BY position, created_at, id;
