-- @param id string
-- @param parentId string?
UPDATE folders SET parent_id = :parentId WHERE parent_id = :id;
