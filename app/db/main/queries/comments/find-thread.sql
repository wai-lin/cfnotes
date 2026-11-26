-- :one
-- @param id string
SELECT id, page_id FROM comment_threads WHERE id = :id;
