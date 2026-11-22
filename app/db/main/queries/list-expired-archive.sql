-- @param before number
SELECT id FROM pages
WHERE archived_at IS NOT NULL AND archived_at < :before AND archived_with = id;
