-- A new page made from `fromId` is shared with the same people.
-- @param fromId string
-- @param toId string
-- @param now number
INSERT OR IGNORE INTO shares (target_kind, target_id, email, role, created_at, created_by)
SELECT 'page', :toId, email, role, :now, created_by FROM shares
WHERE target_kind = 'page' AND target_id = :fromId;
