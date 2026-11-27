-- up
-- A locked page or folder can't be changed by the people it's shared with:
-- a share on it, or on anything it holds (a folder's pages and subfolders, a
-- database's rows, a page's inline databases), allows at most commenting.
-- Owners aren't held back. NULL is unlocked.
ALTER TABLE pages ADD COLUMN locked_at INTEGER;
ALTER TABLE pages ADD COLUMN locked_by TEXT;
ALTER TABLE folders ADD COLUMN locked_at INTEGER;
ALTER TABLE folders ADD COLUMN locked_by TEXT;

-- down
ALTER TABLE folders DROP COLUMN locked_by;
ALTER TABLE folders DROP COLUMN locked_at;
ALTER TABLE pages DROP COLUMN locked_by;
ALTER TABLE pages DROP COLUMN locked_at;
