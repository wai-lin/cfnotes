-- @param now number
-- @param idleSince number
DELETE FROM sessions WHERE expires_at <= :now OR last_seen_at <= :idleSince;
