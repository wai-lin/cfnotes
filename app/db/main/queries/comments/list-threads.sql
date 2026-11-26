-- @param pageId string
SELECT id, quote, created_at, created_by, resolved_at, resolved_by FROM comment_threads
WHERE page_id = :pageId
ORDER BY created_at, id;
