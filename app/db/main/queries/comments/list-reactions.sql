-- Every reaction on a page's comments, oldest first.
-- @param pageId string
SELECT r.comment_id, r.email, r.emoji
FROM comment_reactions r
JOIN comments c ON c.id = r.comment_id
JOIN comment_threads t ON t.id = c.thread_id
WHERE t.page_id = :pageId
ORDER BY r.created_at, r.email;
