-- up
-- Plain text of each page's document, for search. The app keeps it in step on
-- save; this backfills existing pages roughly (the next save makes it exact).
ALTER TABLE pages ADD COLUMN body_text TEXT;

UPDATE pages
SET body_text = (
	SELECT group_concat(value, ' ') FROM json_tree(pages.content) WHERE key = 'text' AND type = 'text'
)
WHERE content IS NOT NULL AND json_valid(content);

-- down
ALTER TABLE pages DROP COLUMN body_text;
