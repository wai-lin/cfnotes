-- @param id string
-- @param content string
-- @param bodyText string
-- @param now number
UPDATE pages SET content = :content, body_text = :bodyText, updated_at = :now WHERE id = :id;
