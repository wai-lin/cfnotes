-- @param columnId string
-- @param toId string
DELETE FROM row_relations WHERE column_id = :columnId AND to_id = :toId;
