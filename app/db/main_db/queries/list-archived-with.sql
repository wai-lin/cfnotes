-- name: listArchivedWith :many
-- @param roots string
SELECT id FROM pages
WHERE archived_at IS NOT NULL AND archived_with IN (SELECT value FROM json_each(:roots));
