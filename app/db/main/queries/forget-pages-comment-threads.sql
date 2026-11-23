-- @param ids string
DELETE FROM comment_threads WHERE page_id IN (SELECT value FROM json_each(:ids));
