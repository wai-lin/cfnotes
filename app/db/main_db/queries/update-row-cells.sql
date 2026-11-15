-- name: updateRowCells :exec
-- @param id string
-- @param cells string
-- @param now number
UPDATE pages SET cells = :cells, updated_at = :now WHERE id = :id;
