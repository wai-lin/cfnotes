-- @param ids string
DELETE FROM page_links
WHERE from_id IN (SELECT value FROM json_each(:ids)) OR to_id IN (SELECT value FROM json_each(:ids));
