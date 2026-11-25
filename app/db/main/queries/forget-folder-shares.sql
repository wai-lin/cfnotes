-- @param id string
DELETE FROM shares WHERE target_kind = 'folder' AND target_id = :id;
