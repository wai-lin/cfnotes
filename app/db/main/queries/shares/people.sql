-- Everyone page `id` is shared with: through a share on it, on what holds it
-- (its database, its host page), or on a folder above it.
-- @param id string
-- @column email string
WITH RECURSIVE up(kind, id) AS (
	SELECT 'page', :id
	UNION
	SELECT CASE WHEN p.database_id IS NOT NULL OR p.host_id IS NOT NULL THEN 'page' ELSE 'folder' END,
		COALESCE(p.database_id, p.host_id, p.folder_id)
	FROM up JOIN pages p ON p.id = up.id
	WHERE up.kind = 'page' AND COALESCE(p.database_id, p.host_id, p.folder_id) IS NOT NULL
	UNION
	SELECT 'folder', f.parent_id
	FROM up JOIN folders f ON f.id = up.id
	WHERE up.kind = 'folder' AND f.parent_id IS NOT NULL
)
SELECT DISTINCT s.email FROM up
JOIN shares s ON s.target_kind = up.kind AND s.target_id = up.id
ORDER BY s.email;
