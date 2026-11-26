-- :one
-- A comment, with the page its thread is on.
-- @param id string
SELECT c.id, c.thread_id, c.author, t.page_id
FROM comments c JOIN comment_threads t ON t.id = c.thread_id
WHERE c.id = :id;
