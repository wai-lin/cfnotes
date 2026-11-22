-- name: releaseFolderPages :exec
-- @param id string
UPDATE pages SET folder_id = :parentId WHERE folder_id = :id;
