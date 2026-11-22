-- @param id string
-- @param name string
-- @param now number
-- @param parentId string?
INSERT INTO folders (id, parent_id, name, created_at) VALUES (:id, :parentId, :name, :now);
