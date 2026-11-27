-- up
-- Reactions on comments: each person's emoji on a comment, at most one of each.
-- They go with the comment (see the comments queries that delete them).
CREATE TABLE comment_reactions (
	comment_id TEXT NOT NULL REFERENCES comments (id) ON DELETE CASCADE,
	email TEXT NOT NULL,
	emoji TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (comment_id, email, emoji)
);

-- down
DROP TABLE comment_reactions;
