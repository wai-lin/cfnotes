-- Locks a page (`at` set) or unlocks it (`at` null).
-- @param id string
-- @param at number?
-- @param by string?
UPDATE pages SET locked_at = :at, locked_by = :by WHERE id = :id;
