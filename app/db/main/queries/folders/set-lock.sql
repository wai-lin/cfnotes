-- Locks a folder (`at` set) or unlocks it (`at` null).
-- @param id string
-- @param at number?
-- @param by string?
UPDATE folders SET locked_at = :at, locked_by = :by WHERE id = :id;
