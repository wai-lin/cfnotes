-- @param id string
-- @param name string
-- @param tokenHash string
-- @param scope string
-- @param now number
-- @param by string
INSERT INTO api_tokens (id, name, token_hash, scope, created_at, created_by)
VALUES (:id, :name, :tokenHash, :scope, :now, :by);
