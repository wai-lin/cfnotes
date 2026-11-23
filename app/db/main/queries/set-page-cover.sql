-- @param id string
-- @param now number
-- @param by string?
-- @param cover string?
UPDATE pages SET cover = :cover, updated_at = :now, updated_by = :by WHERE id = :id;
