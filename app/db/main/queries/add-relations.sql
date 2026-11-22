-- `pairs` is a JSON array of [from_id, to_id]; its order becomes the position.
-- @param columnId string
-- @param pairs string
INSERT OR IGNORE INTO row_relations (column_id, from_id, to_id, position)
SELECT :columnId, json_extract(value, '$[0]'), json_extract(value, '$[1]'), CAST(key AS INTEGER)
FROM json_each(:pairs);
