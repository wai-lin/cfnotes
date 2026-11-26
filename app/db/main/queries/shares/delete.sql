-- @param kind string
-- @param id string
-- @param email string
DELETE FROM shares WHERE target_kind = :kind AND target_id = :id AND email = :email;
