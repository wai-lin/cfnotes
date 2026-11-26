-- @param id string
-- @param cells string
-- @param now number
-- @param by string?
UPDATE pages SET cells = :cells, updated_at = :now, updated_by = :by WHERE id = :id;
