-- Creates the block the first time any page saves it.
-- @param id string
-- @param content string
-- @param now number
-- @param by string?
INSERT INTO synced_blocks (id, content, updated_at, updated_by)
VALUES (:id, :content, :now, :by)
ON CONFLICT (id) DO UPDATE SET content = :content, updated_at = :now, updated_by = :by;
