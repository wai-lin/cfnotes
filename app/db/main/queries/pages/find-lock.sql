-- :one
-- What locks page `id`, nearest first: itself, its database or host page, or a
-- folder above it. Nothing when none of those is locked.
-- @param id string
-- @column kind string
-- @column id string
-- @column name string?
WITH RECURSIVE up(kind, id, depth) AS (
	SELECT 'page', :id, 0
	UNION
	SELECT CASE WHEN p.database_id IS NOT NULL OR p.host_id IS NOT NULL THEN 'page' ELSE 'folder' END,
		COALESCE(p.database_id, p.host_id, p.folder_id), up.depth + 1
	FROM up JOIN pages p ON p.id = up.id
	WHERE up.kind = 'page' AND COALESCE(p.database_id, p.host_id, p.folder_id) IS NOT NULL
		AND up.depth < 100
	UNION
	SELECT 'folder', f.parent_id, up.depth + 1
	FROM up JOIN folders f ON f.id = up.id
	WHERE up.kind = 'folder' AND f.parent_id IS NOT NULL AND up.depth < 100
)
SELECT up.kind, up.id, COALESCE(p.title, f.name) AS name
FROM up
LEFT JOIN pages p ON up.kind = 'page' AND p.id = up.id
LEFT JOIN folders f ON up.kind = 'folder' AND f.id = up.id
WHERE COALESCE(p.locked_at, f.locked_at) IS NOT NULL
ORDER BY up.depth
LIMIT 1;
