-- name: updatePageTitle :exec
-- @param id string
-- @param title string
-- @param now number
UPDATE pages SET title = :title, updated_at = :now WHERE id = :id;
