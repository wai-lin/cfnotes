-- @param id string
DELETE FROM comment_threads
WHERE id = :id AND NOT EXISTS (SELECT 1 FROM comments WHERE thread_id = :id);
