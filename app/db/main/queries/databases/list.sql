SELECT id, title, host_id FROM pages
WHERE kind = 'database' AND archived_at IS NULL
ORDER BY title COLLATE NOCASE, id;
