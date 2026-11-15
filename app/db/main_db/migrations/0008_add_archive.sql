-- up
-- Archived pages are hidden everywhere and deleted for good after a while.
-- `archived_with` is the page whose removal archived this one (itself for the
-- thing that was removed), so a database comes back together with its rows.
ALTER TABLE pages ADD COLUMN archived_at INTEGER;
ALTER TABLE pages ADD COLUMN archived_with TEXT;

CREATE INDEX pages_archived_idx ON pages (archived_at);
CREATE INDEX pages_archived_with_idx ON pages (archived_with);

-- down
DROP INDEX pages_archived_with_idx;
DROP INDEX pages_archived_idx;
ALTER TABLE pages DROP COLUMN archived_with;
ALTER TABLE pages DROP COLUMN archived_at;
