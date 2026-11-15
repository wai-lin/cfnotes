-- name: releaseFolderChildren :exec
-- @param id string
UPDATE folders SET parent_id = :parentId WHERE parent_id = :id;
