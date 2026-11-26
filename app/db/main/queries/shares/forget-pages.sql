-- @param ids string
DELETE FROM shares
WHERE target_kind = 'page' AND target_id IN (SELECT value FROM json_each(:ids));
