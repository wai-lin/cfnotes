-- name: renameFolder :exec
-- @param id string
-- @param name string
UPDATE folders SET name = :name WHERE id = :id;
