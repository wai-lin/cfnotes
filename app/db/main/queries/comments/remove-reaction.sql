-- @param commentId string
-- @param email string
-- @param emoji string
DELETE FROM comment_reactions
WHERE comment_id = :commentId AND email = :email AND emoji = :emoji;
