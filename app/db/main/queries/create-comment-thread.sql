-- @param id string
-- @param pageId string
-- @param quote string?
-- @param now number
-- @param by string?
INSERT INTO comment_threads (id, page_id, quote, created_at, created_by)
VALUES (:id, :pageId, :quote, :now, :by);
