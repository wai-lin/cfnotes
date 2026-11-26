-- What quick-find shows before anything is typed.
-- @column parent_title string?
SELECT id, title, kind, icon,
	(SELECT d.title FROM pages d WHERE d.id = pages.database_id) AS parent_title
FROM pages
WHERE archived_at IS NULL
ORDER BY updated_at DESC
LIMIT 8;
