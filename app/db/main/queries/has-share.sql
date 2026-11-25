-- :one
-- Whether `email` has any share (so may sign in), and any that lets them edit.
-- @param email string
-- @column shared number
-- @column edits number
SELECT
	EXISTS (SELECT 1 FROM shares WHERE email = :email) AS shared,
	EXISTS (SELECT 1 FROM shares WHERE email = :email AND role = 'edit') AS edits;
