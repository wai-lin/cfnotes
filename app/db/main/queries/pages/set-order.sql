-- Renumbers pages from a JSON array of ids: each page's position becomes its index.
-- @param ids string
UPDATE pages
SET position = (SELECT CAST(key AS INTEGER) FROM json_each(:ids) WHERE value = pages.id)
WHERE id IN (SELECT value FROM json_each(:ids));
