-- @param commentId string
-- @param email string
-- @param emoji string
-- @column found number
SELECT 1 AS found FROM comment_reactions
WHERE comment_id = :commentId AND email = :email AND emoji = :emoji;
