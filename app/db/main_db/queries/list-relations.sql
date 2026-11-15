-- name: listRelations :many
-- Links touching any row of a database (either side).
-- @param databaseId string
SELECT column_id, from_id, to_id FROM row_relations
WHERE from_id IN (SELECT id FROM pages WHERE database_id = :databaseId)
OR to_id IN (SELECT id FROM pages WHERE database_id = :databaseId)
ORDER BY position, from_id, to_id;
