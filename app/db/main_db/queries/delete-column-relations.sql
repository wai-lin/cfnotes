-- name: deleteColumnRelations :exec
-- @param columnId string
DELETE FROM row_relations WHERE column_id = :columnId;
