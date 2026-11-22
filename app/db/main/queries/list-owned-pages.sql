-- Rows of a database and databases embedded in a page (not already archived).
-- @param ids string
SELECT id FROM pages
WHERE (database_id IN (SELECT value FROM json_each(:ids))
	OR host_id IN (SELECT value FROM json_each(:ids)))
AND archived_at IS NULL;
