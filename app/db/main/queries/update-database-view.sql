-- @param id string
-- @param view string
-- @param now number
UPDATE pages SET view = :view, updated_at = :now WHERE id = :id AND kind = 'database';
