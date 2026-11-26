-- @param id string
-- @param threadId string
-- @param body string
-- @param now number
-- @param by string?
INSERT INTO comments (id, thread_id, body, author, created_at)
VALUES (:id, :threadId, :body, :by, :now);
