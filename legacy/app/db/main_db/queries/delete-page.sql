-- name: deletePage :exec
-- @param id string
DELETE FROM pages WHERE id = :id;
