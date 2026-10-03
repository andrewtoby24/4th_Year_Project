USE qr_attendance;

INSERT INTO subjects (code, name, year_level, teacher_registration_enabled) VALUES
  ('IT31022', 'Computer Network', 3, 1),
  ('IT31035', 'Web Development II (PHP)', 3, 1),
  ('IT31045', 'Java Programming', 3, 1),
  ('IT31055', 'Data Structure', 3, 1),
  ('IT31016', 'Database Management System (DBMS)', 3, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  year_level = VALUES(year_level),
  teacher_registration_enabled = VALUES(teacher_registration_enabled);

ALTER TABLE teachers
  ADD COLUMN class_name VARCHAR(30) NULL AFTER staff_no;

UPDATE teachers
SET class_name = CONCAT(year_level, 'IT')
WHERE class_name IS NULL AND year_level IS NOT NULL;

ALTER TABLE attendance_sessions
  ADD COLUMN class_name VARCHAR(30) NULL AFTER year_level;

UPDATE attendance_sessions
SET class_name = CONCAT(year_level, 'IT')
WHERE class_name IS NULL AND year_level IS NOT NULL;
