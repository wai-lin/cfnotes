-- up
-- A database's table view settings (sorts and filters), as JSON.
ALTER TABLE pages ADD COLUMN view TEXT;

-- down
ALTER TABLE pages DROP COLUMN view;
