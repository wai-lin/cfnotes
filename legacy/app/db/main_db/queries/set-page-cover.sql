-- name: setPageCover :exec
-- @param id string
-- @param now number
UPDATE pages SET cover = :cover, updated_at = :now WHERE id = :id;
