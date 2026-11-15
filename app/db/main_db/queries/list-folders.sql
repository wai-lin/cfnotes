-- name: listFolders :many
SELECT id, parent_id, name FROM folders ORDER BY name COLLATE NOCASE, created_at, id;
