-- Pair with forgetPages, first.
-- @param ids string
DELETE FROM comment_reactions
WHERE comment_id IN (
	SELECT c.id FROM comments c JOIN comment_threads t ON t.id = c.thread_id
	WHERE t.page_id IN (SELECT value FROM json_each(:ids))
);
