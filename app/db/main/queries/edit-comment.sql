-- @param id string
-- @param body string
-- @param now number
UPDATE comments SET body = :body, edited_at = :now WHERE id = :id;
