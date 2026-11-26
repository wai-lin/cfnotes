-- @param ids string
SELECT id, content, updated_at FROM synced_blocks
WHERE id IN (SELECT value FROM json_each(:ids));
