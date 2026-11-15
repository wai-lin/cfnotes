-- name: findDatabase :one
-- @param id string
SELECT id, title, columns, view, host_id FROM pages
WHERE id = :id AND kind = 'database' AND archived_at IS NULL;
