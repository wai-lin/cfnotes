-- up
-- Notion-style page decoration: `icon` is an emoji; `cover` is a preset
-- gradient id (`g1`…) or the path of an uploaded image (`/files/img/…`).
ALTER TABLE pages ADD COLUMN icon TEXT;
ALTER TABLE pages ADD COLUMN cover TEXT;

-- down
ALTER TABLE pages DROP COLUMN cover;
ALTER TABLE pages DROP COLUMN icon;
