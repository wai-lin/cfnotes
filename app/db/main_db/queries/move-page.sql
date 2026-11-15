-- name: movePage :exec
-- Moves a page to the end of another folder (NULL = top level).
-- @param id string
UPDATE pages
SET
	position = (SELECT COALESCE(MAX(position), -1) + 1 FROM pages WHERE folder_id IS :folderId),
	folder_id = :folderId
WHERE id = :id;
