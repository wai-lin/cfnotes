-- @param id string
-- @param content string
-- @param bodyText string
-- @param now number
-- @param by string?
UPDATE pages SET content = :content, body_text = :bodyText, updated_at = :now, updated_by = :by WHERE id = :id;
