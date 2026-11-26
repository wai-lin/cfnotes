-- @param tokenHash string
-- @param email string
-- @param expiresAt number
-- @param now number
INSERT INTO sessions (token_hash, email, expires_at, last_seen_at)
VALUES (:tokenHash, :email, :expiresAt, :now);
