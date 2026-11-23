-- @param id string
-- @param title string
-- @param now number
-- @param by string?
UPDATE pages SET title = :title, updated_at = :now, updated_by = :by WHERE id = :id;
