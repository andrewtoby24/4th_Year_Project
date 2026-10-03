USE qr_attendance;

ALTER TABLE attendance_sessions
  MODIFY COLUMN expires_at DATETIME NULL,
  ADD COLUMN ended_at DATETIME NULL AFTER expires_at;

ALTER TABLE qr_codes
  ADD COLUMN display_token VARCHAR(100) NULL AFTER token_hash,
  MODIFY COLUMN expires_at DATETIME NULL;

-- Existing tokens were stored only as one-way hashes and cannot be restored.
-- Newly created sessions store a teacher-display copy here while student scans
-- continue to be verified against token_hash.
