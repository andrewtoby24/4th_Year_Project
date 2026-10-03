USE qr_attendance;

ALTER TABLE subjects
  ADD COLUMN year_level TINYINT UNSIGNED NULL AFTER name,
  ADD COLUMN teacher_registration_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER year_level;

INSERT INTO subjects (code, name, year_level, teacher_registration_enabled) VALUES
  ('IT41023', 'Computer Architecture and Organization', 4, 1),
  ('IT41033', 'Operating Systems', 4, 1),
  ('IT41032', 'Advanced Computer Networks', 4, 1),
  ('IT41026', 'Advanced Data Management Techniques', 4, 1),
  ('IT41017', 'Modern Control System', 4, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  year_level = VALUES(year_level),
  teacher_registration_enabled = VALUES(teacher_registration_enabled);

ALTER TABLE teachers
  ADD COLUMN subject_id INT NULL AFTER staff_no,
  ADD COLUMN subject_code VARCHAR(30) NULL AFTER subject_id,
  ADD COLUMN year_level TINYINT UNSIGNED NULL AFTER subject_code,
  ADD CONSTRAINT teachers_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id);

ALTER TABLE students
  ADD COLUMN class_name VARCHAR(30) NULL AFTER student_no,
  ADD COLUMN year_level TINYINT UNSIGNED NULL AFTER class_name;

