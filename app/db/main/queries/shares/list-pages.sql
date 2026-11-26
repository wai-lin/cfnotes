-- Pages shared with `email` directly, rows and inline databases included.
-- @param email string
SELECT p.id, p.folder_id, p.title, p.kind, p.icon FROM shares s
JOIN pages p ON p.id = s.target_id
WHERE s.target_kind = 'page' AND s.email = :email AND p.archived_at IS NULL
ORDER BY p.position, p.created_at, p.id;
