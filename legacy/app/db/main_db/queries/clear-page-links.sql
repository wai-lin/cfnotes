-- name: clearPageLinks :exec
-- @param id string
DELETE FROM page_links WHERE from_id = :id;
