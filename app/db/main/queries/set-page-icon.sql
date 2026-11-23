-- @param id string
-- @param now number
-- @param by string?
-- @param icon string?
UPDATE pages SET icon = :icon, updated_at = :now, updated_by = :by WHERE id = :id;
