-- Every comment on a page's threads.
-- @param pageId string
SELECT c.id, c.thread_id, c.body, c.author, c.created_at, c.edited_at
FROM comments c JOIN comment_threads t ON t.id = c.thread_id
WHERE t.page_id = :pageId
ORDER BY c.created_at, c.id;
