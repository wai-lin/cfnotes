-- name: clearRelationsFrom :exec
-- @param columnId string
-- @param fromId string
DELETE FROM row_relations WHERE column_id = :columnId AND from_id = :fromId;
