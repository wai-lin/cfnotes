-- :one
-- @param tokenHash string
SELECT id, scope, created_by, last_used_at FROM api_tokens WHERE token_hash = :tokenHash;
