-- Quick-find in Trash: trashed pages containing `pattern` in the title or body.
-- `archived_with` is the Trash item each one is listed under.
-- @param pattern string
-- @column updated_at number
-- @column parent_title string?
SELECT id, title, kind, icon, body_text, archived_at AS updated_at, archived_with,
	(SELECT d.title FROM pages d WHERE d.id = pages.database_id) AS parent_title
FROM pages
WHERE archived_at IS NOT NULL
	AND (title LIKE :pattern ESCAPE '\' OR body_text LIKE :pattern ESCAPE '\')
ORDER BY archived_at DESC
LIMIT 200;
