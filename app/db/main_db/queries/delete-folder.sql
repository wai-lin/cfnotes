-- name: deleteFolder :exec
-- @param id string
DELETE FROM folders WHERE id = :id;
