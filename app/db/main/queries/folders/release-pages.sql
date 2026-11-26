-- @param id string
-- @param parentId string?
UPDATE pages SET folder_id = :parentId WHERE folder_id = :id;
