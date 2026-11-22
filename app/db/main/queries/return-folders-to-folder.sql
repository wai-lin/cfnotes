-- Undo of a folder delete: its subfolders go back, unless they were moved since.
-- @param id string
-- @param ids string
-- @param parentId string?
UPDATE folders SET parent_id = :id
WHERE id IN (SELECT value FROM json_each(:ids)) AND parent_id IS :parentId;
