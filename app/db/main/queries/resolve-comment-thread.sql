-- Resolves a thread, or (with a null time) opens it again.
-- @param id string
-- @param at number?
-- @param by string?
UPDATE comment_threads SET resolved_at = :at, resolved_by = :by WHERE id = :id;
