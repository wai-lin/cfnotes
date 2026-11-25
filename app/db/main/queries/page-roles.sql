-- How far `email` may go on each of `ids`, through a share on the page itself,
-- on what holds it (its database, its host page), or on a folder above it.
-- rank: 1 view, 2 comment, 3 edit. Pages with no share aren't listed.
-- @param ids string
-- @param email string
-- @column id string
-- @column rank number
WITH RECURSIVE up(root, kind, id) AS (
	SELECT value, 'page', value FROM json_each(:ids)
	UNION
	SELECT up.root,
		CASE WHEN p.database_id IS NOT NULL OR p.host_id IS NOT NULL THEN 'page' ELSE 'folder' END,
		COALESCE(p.database_id, p.host_id, p.folder_id)
	FROM up JOIN pages p ON p.id = up.id
	WHERE up.kind = 'page' AND COALESCE(p.database_id, p.host_id, p.folder_id) IS NOT NULL
	UNION
	SELECT up.root, 'folder', f.parent_id
	FROM up JOIN folders f ON f.id = up.id
	WHERE up.kind = 'folder' AND f.parent_id IS NOT NULL
)
SELECT up.root AS id,
	MAX(CASE s.role WHEN 'edit' THEN 3 WHEN 'comment' THEN 2 ELSE 1 END) AS rank
FROM up
JOIN shares s ON s.target_kind = up.kind AND s.target_id = up.id AND s.email = :email
GROUP BY up.root;
