-- What's shared with `email`.
-- @param email string
SELECT target_kind, target_id, role FROM shares WHERE email = :email ORDER BY created_at;
