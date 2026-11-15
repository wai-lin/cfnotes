-- name: searchPages :many
-- Candidates containing `pattern` (the query's longest word as a LIKE pattern)
-- in the title or body; the caller checks the other words and ranks them.
-- @param pattern string
SELECT id, title, kind, icon, body_text, updated_at,
	(SELECT d.title FROM pages d WHERE d.id = pages.database_id) AS parent_title
FROM pages
WHERE archived_at IS NULL
	AND (title LIKE :pattern ESCAPE '\' OR body_text LIKE :pattern ESCAPE '\')
ORDER BY updated_at DESC
LIMIT 200;
