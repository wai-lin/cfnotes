-- name: listFolderPageIds :many
-- Every page directly in a folder, trashed ones too (Undo puts them all back).
-- @param id string
SELECT id FROM pages WHERE folder_id = :id;
