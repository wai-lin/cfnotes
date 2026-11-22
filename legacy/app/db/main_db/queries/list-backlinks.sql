-- name: listBacklinks :many
-- @param id string
SELECT pages.id, pages.title FROM page_links
JOIN pages ON pages.id = page_links.from_id
WHERE page_links.to_id = :id AND pages.archived_at IS NULL
ORDER BY pages.title COLLATE NOCASE, pages.id;
