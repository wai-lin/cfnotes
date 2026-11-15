-- name: updateDatabaseColumns :exec
-- @param id string
-- @param columns string
-- @param now number
UPDATE pages SET columns = :columns, updated_at = :now WHERE id = :id AND kind = 'database';
