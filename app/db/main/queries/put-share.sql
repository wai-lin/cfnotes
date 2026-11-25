-- Shares a page or folder with `email`, or changes their role.
-- @param kind string
-- @param id string
-- @param email string
-- @param role string
-- @param now number
-- @param by string?
INSERT INTO shares (target_kind, target_id, email, role, created_at, created_by)
VALUES (:kind, :id, :email, :role, :now, :by)
ON CONFLICT (target_kind, target_id, email) DO UPDATE SET role = excluded.role;
