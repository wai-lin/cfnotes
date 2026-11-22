-- @param ids string
-- @param root string
-- @param now number
UPDATE pages SET archived_at = :now, archived_with = :root
WHERE id IN (SELECT value FROM json_each(:ids)) AND archived_at IS NULL;
