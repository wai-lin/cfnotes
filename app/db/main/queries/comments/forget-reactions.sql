-- A comment's reactions, as it's deleted. Pair with delete, first.
-- @param id string
DELETE FROM comment_reactions WHERE comment_id = :id;
