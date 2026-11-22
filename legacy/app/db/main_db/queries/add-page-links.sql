-- name: addPageLinks :exec
-- Links to pages that no longer exist are skipped.
-- @param id string
-- @param ids string
INSERT OR IGNORE INTO page_links (from_id, to_id)
SELECT :id, value FROM json_each(:ids) WHERE value IN (SELECT id FROM pages);
