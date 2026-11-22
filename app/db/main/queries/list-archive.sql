-- Each thing that was archived (not the rows that went with it), newest first.
-- @column database_title string?
-- @column items number
SELECT
	pages.id, pages.title, pages.kind, pages.database_id, pages.host_id, pages.archived_at,
	(SELECT title FROM pages AS db WHERE db.id = pages.database_id) AS database_title,
	(SELECT COUNT(*) FROM pages AS inside WHERE inside.archived_with = pages.id) AS items
FROM pages
WHERE pages.archived_at IS NOT NULL AND pages.archived_with = pages.id
ORDER BY pages.archived_at DESC;
