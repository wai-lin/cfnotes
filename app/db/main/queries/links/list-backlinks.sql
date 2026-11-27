-- Pages linking to page `id`: in their content, or in a comment on them.
-- @param id string
SELECT pages.id, pages.title FROM pages
WHERE pages.archived_at IS NULL AND pages.id != :id AND (
	pages.id IN (SELECT from_id FROM page_links WHERE to_id = :id)
	OR pages.id IN (
		SELECT t.page_id FROM comment_threads t JOIN comments c ON c.thread_id = t.id
		WHERE c.body LIKE '%/p/' || :id || '%'
	)
)
ORDER BY pages.title COLLATE NOCASE, pages.id;
