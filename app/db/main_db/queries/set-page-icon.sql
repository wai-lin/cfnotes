-- name: setPageIcon :exec
-- @param id string
-- @param now number
UPDATE pages SET icon = :icon, updated_at = :now WHERE id = :id;
