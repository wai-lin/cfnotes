-- Every thread on a page that isn't in Trash, the latest commented on first,
-- with its page's title and whether one of its comments mentions :email.
-- @param email string
-- @column last_at number?
-- @column mentions number
SELECT
	t.id,
	t.page_id,
	p.title AS page_title,
	t.resolved_at,
	(SELECT MAX(c.created_at) FROM comments c WHERE c.thread_id = t.id) AS last_at,
	EXISTS (
		SELECT 1 FROM comments c
		WHERE c.thread_id = t.id
			AND instr(lower(c.body), '](mailto:' || :email || ')') > 0
	) AS mentions
FROM comment_threads t
JOIN pages p ON p.id = t.page_id
WHERE p.archived_at IS NULL
ORDER BY last_at DESC, t.id;
