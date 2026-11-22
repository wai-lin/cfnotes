-- An inline database whose page is gone becomes a full-page database.
-- @param id string
UPDATE pages SET host_id = NULL, folder_id = NULL WHERE id = :id;
