-- Every page that isn't in Trash, for the API: pages, databases and rows.
SELECT id, title, kind, icon, folder_id, database_id, host_id, created_at, updated_at,
	created_by, updated_by
FROM pages
WHERE archived_at IS NULL
ORDER BY position, created_at, id;
