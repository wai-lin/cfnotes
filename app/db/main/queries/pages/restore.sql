-- Brings back everything archived together with `root`.
-- @param root string
UPDATE pages SET archived_at = NULL, archived_with = NULL WHERE archived_with = :root;
