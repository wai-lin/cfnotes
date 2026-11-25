-- Who a page or folder is shared with.
-- @param kind string
-- @param id string
SELECT email, role, created_at, created_by FROM shares
WHERE target_kind = :kind AND target_id = :id
ORDER BY created_at, email;
