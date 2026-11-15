-- name: listRecentTrash :many
-- What quick-find shows in Trash before anything is typed: the latest items.
SELECT id, title, kind, icon, archived_with,
	(SELECT d.title FROM pages d WHERE d.id = pages.database_id) AS parent_title
FROM pages
WHERE archived_at IS NOT NULL AND archived_with = id
ORDER BY archived_at DESC
LIMIT 8;
