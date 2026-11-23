-- Pair with deleteEmptyCommentThread.
-- @param id string
DELETE FROM comments WHERE id = :id;
