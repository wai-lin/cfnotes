-- name: forgetPagesRelations :exec
-- @param ids string
DELETE FROM row_relations
WHERE from_id IN (SELECT value FROM json_each(:ids)) OR to_id IN (SELECT value FROM json_each(:ids));
