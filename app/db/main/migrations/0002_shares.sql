-- up
-- Pages and folders shared with people outside ALLOWED_EMAILS. A share on a
-- folder covers everything in it, subfolders included; one on a page covers
-- its rows and inline databases too. `role` is 'view', 'comment' or 'edit'.
-- People are emails, as in sessions; anyone with a share may sign in.
CREATE TABLE shares (
	target_kind TEXT NOT NULL,
	target_id TEXT NOT NULL,
	email TEXT NOT NULL,
	role TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	created_by TEXT,
	PRIMARY KEY (target_kind, target_id, email)
) WITHOUT ROWID;

CREATE INDEX shares_email_idx ON shares (email);

-- down
DROP TABLE shares;
