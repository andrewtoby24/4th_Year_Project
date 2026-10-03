USE qr_attendance;

CREATE TABLE teacher_subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY teacher_subject_unique (teacher_id, subject_id),
  CONSTRAINT teacher_subjects_teacher_fk FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT teacher_subjects_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- Preserve every existing teacher's current subject while moving the source of
-- truth to the many-to-many relationship table.
INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id)
SELECT id, subject_id FROM teachers WHERE subject_id IS NOT NULL;

INSERT IGNORE INTO teacher_subjects (teacher_id, subject_id)
SELECT DISTINCT teacher_id, subject_id FROM attendance_sessions;

ALTER TABLE attendance_sessions
  ADD COLUMN year_level TINYINT UNSIGNED NULL AFTER subject_id;

UPDATE attendance_sessions x
JOIN subjects s ON s.id = x.subject_id
SET x.year_level = s.year_level
WHERE x.year_level IS NULL;
