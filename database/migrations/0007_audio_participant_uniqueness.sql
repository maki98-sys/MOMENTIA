-- Prevent duplicate device-less participant rows; PostgreSQL treats NULLs as distinct in ordinary unique constraints.
BEGIN;
CREATE UNIQUE INDEX audio_participants_session_user_no_device_uq
  ON audio_participants(session_id, user_id)
  WHERE device_id IS NULL;
INSERT INTO schema_migrations(version) VALUES ('0007_audio_participant_uniqueness');
COMMIT;
