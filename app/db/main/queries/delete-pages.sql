-- Pair with forgetPagesLinks.
-- @param ids string
DELETE FROM pages WHERE id IN (SELECT value FROM json_each(:ids));
