-- Pair with forgetPagesCommentThreads, first.
-- @param ids string
DELETE FROM comments
WHERE thread_id IN (
	SELECT id FROM comment_threads WHERE page_id IN (SELECT value FROM json_each(:ids))
);
