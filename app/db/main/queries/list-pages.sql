-- Sidebar pages: rows and inline databases live inside other pages.
SELECT id, folder_id, title, kind, icon FROM pages
WHERE database_id IS NULL AND host_id IS NULL AND archived_at IS NULL
ORDER BY position, created_at, id;
