-- The documents of a database's rows, for the API.
-- @param databaseId string
SELECT id, content FROM pages
WHERE database_id = :databaseId AND archived_at IS NULL;
