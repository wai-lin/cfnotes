-- @param id string
-- @param now number
-- @param icon string?
UPDATE pages SET icon = :icon, updated_at = :now WHERE id = :id;
