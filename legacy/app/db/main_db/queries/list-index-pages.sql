-- name: listIndexPages :many
-- Pages that aren't in the sidebar (database rows, inline databases), for linking.
SELECT id, title FROM pages
WHERE (database_id IS NOT NULL OR host_id IS NOT NULL) AND archived_at IS NULL;
