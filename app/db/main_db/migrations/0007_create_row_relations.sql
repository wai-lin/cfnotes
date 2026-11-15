-- up
-- Links made by relation columns. `column_id` is the relation column that owns
-- the link (in the database of `from_id`); a two-way relation's other side
-- reads the same rows from `to_id`.
CREATE TABLE row_relations (
	column_id TEXT NOT NULL,
	from_id TEXT NOT NULL,
	to_id TEXT NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (column_id, from_id, to_id)
) WITHOUT ROWID;

CREATE INDEX row_relations_from_idx ON row_relations (from_id);
CREATE INDEX row_relations_to_idx ON row_relations (to_id);

-- down
DROP TABLE row_relations;
