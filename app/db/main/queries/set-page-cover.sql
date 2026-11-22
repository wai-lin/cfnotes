-- @param id string
-- @param now number
-- @param cover string?
UPDATE pages SET cover = :cover, updated_at = :now WHERE id = :id;
