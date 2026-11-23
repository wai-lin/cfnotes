-- :one
-- @param tokenHash string
SELECT email, expires_at, last_seen_at FROM sessions WHERE token_hash = :tokenHash;
