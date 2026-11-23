-- @param tokenHash string
-- @param now number
UPDATE sessions SET last_seen_at = :now WHERE token_hash = :tokenHash;
