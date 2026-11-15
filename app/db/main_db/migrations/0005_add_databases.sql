-- up
-- kind: 'page' or 'database'. A database keeps its column definitions in `columns`
-- (JSON). Its rows are pages with `database_id` set and their values in `cells`
-- (JSON). An inline database has `host_id` set to the page that embeds it.
-- Rows and inline databases stay out of the sidebar.
ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';
ALTER TABLE pages ADD COLUMN database_id TEXT;
ALTER TABLE pages ADD COLUMN host_id TEXT;
ALTER TABLE pages ADD COLUMN columns TEXT;
ALTER TABLE pages ADD COLUMN cells TEXT;

CREATE INDEX pages_database_idx ON pages (database_id, position);
CREATE INDEX pages_host_idx ON pages (host_id);

-- down
DROP INDEX pages_host_idx;
DROP INDEX pages_database_idx;
ALTER TABLE pages DROP COLUMN cells;
ALTER TABLE pages DROP COLUMN columns;
ALTER TABLE pages DROP COLUMN host_id;
ALTER TABLE pages DROP COLUMN database_id;
ALTER TABLE pages DROP COLUMN kind;
