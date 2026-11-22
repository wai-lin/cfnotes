-- name: returnPagesToFolder :exec
-- Undo of a folder delete: its pages go back, unless they were moved since.
-- @param id string
-- @param ids string
UPDATE pages SET folder_id = :id
WHERE id IN (SELECT value FROM json_each(:ids)) AND folder_id IS :parentId;
