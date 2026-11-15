-- name: moveFolder :exec
-- @param id string
UPDATE folders SET parent_id = :parentId WHERE id = :id;
