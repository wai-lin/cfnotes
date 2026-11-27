-- Adds `email`'s `emoji` to a comment (once).
-- @param commentId string
-- @param email string
-- @param emoji string
-- @param now number
INSERT OR IGNORE INTO comment_reactions (comment_id, email, emoji, created_at)
VALUES (:commentId, :email, :emoji, :now);
