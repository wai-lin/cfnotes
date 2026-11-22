-- @param ids string
SELECT id, title FROM pages
WHERE id IN (SELECT value FROM json_each(:ids)) AND archived_at IS NULL;
