USE qr_attendance;

CREATE TABLE academic_years (
    id TINYINT UNSIGNED PRIMARY KEY,
    year_level TINYINT UNSIGNED NOT NULL UNIQUE,
    name VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO academic_years (id, year_level, name) VALUES
    (1, 1, '1st Year'),
    (2, 2, '2nd Year'),
    (3, 3, '3rd Year'),
    (4, 4, '4th Year'),
    (5, 5, '5th Year'),
    (6, 6, '6th Year');

CREATE TABLE semesters (
    id SMALLINT UNSIGNED PRIMARY KEY,
    academic_year_id TINYINT UNSIGNED NOT NULL,
    semester_number TINYINT UNSIGNED NOT NULL,
    name VARCHAR(30) NOT NULL,
    UNIQUE KEY semester_per_year (
        academic_year_id,
        semester_number
    ),
    CONSTRAINT semesters_academic_year_fk
        FOREIGN KEY (academic_year_id)
        REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO semesters
    (id, academic_year_id, semester_number, name)
VALUES
    (11, 1, 1, '1st Semester'),
    (12, 1, 2, '2nd Semester'),
    (21, 2, 1, '1st Semester'),
    (22, 2, 2, '2nd Semester'),
    (31, 3, 1, '1st Semester'),
    (32, 3, 2, '2nd Semester'),
    (41, 4, 1, '1st Semester'),
    (42, 4, 2, '2nd Semester'),
    (51, 5, 1, '1st Semester'),
    (52, 5, 2, '2nd Semester'),
    (61, 6, 1, '1st Semester'),
    (62, 6, 2, '2nd Semester');

CREATE TABLE classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    academic_year_id TINYINT UNSIGNED NOT NULL,
    name VARCHAR(30) NOT NULL UNIQUE,
    CONSTRAINT classes_academic_year_fk
        FOREIGN KEY (academic_year_id)
        REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO classes (academic_year_id, name) VALUES
    (1, '1IT'),
    (2, '2IT'),
    (3, '3IT'),
    (4, '4IT'),
    (4, '4IT1'),
    (5, '5IT'),
    (6, '6IT');

ALTER TABLE subjects
    DROP INDEX code;

ALTER TABLE subjects
    MODIFY code VARCHAR(30) NULL,
    ADD COLUMN semester_id SMALLINT UNSIGNED NULL AFTER year_level,
    ADD KEY subjects_semester_idx (semester_id),
    ADD CONSTRAINT subjects_semester_fk
        FOREIGN KEY (semester_id)
        REFERENCES semesters(id);

-- Reuse existing subject IDs where the mapping is unambiguous.
-- This preserves all existing session and attendance relationships.

UPDATE subjects
SET code = 'IT-31055',
    name = 'Data Structure',
    year_level = 3,
    semester_id = 31
WHERE code = 'IT31055';

UPDATE subjects
SET code = 'IT-31022',
    name = 'Computer Networks',
    year_level = 3,
    semester_id = 31
WHERE code = 'IT31022';

UPDATE subjects
SET code = 'IT-31035',
    name = 'Web Development Technologies II',
    year_level = 3,
    semester_id = 31
WHERE code = 'IT31035';

UPDATE subjects
SET code = 'IT-31016',
    name = 'Database Management System',
    year_level = 3,
    semester_id = 31
WHERE code = 'IT31016';

UPDATE subjects
SET code = 'IT-41017',
    name = 'Modern Control Systems',
    year_level = 4,
    semester_id = 41
WHERE code = 'IT41017';

UPDATE subjects
SET code = 'IT-41032',
    name = 'Advanced Computer Networks',
    year_level = 4,
    semester_id = 41
WHERE code = 'IT41032';

UPDATE subjects
SET code = 'IT-41023',
    name = 'Computer Architecture and Organization',
    year_level = 4,
    semester_id = 41
WHERE code = 'IT41023';

UPDATE subjects
SET code = 'IT-41033',
    name = 'Operating Systems',
    year_level = 4,
    semester_id = 41
WHERE code = 'IT41033';

UPDATE subjects
SET code = 'IT-41026',
    name = 'Advanced Data Management Techniques',
    year_level = 4,
    semester_id = 41
WHERE code = 'IT41026';

-- Preserve ambiguous legacy subjects without exposing them to registration.
UPDATE subjects
SET teacher_registration_enabled = 0
WHERE code IN ('ADMT', 'IT31045');

CREATE TEMPORARY TABLE subject_seed (
    academic_year_id TINYINT UNSIGNED NOT NULL,
    semester_number TINYINT UNSIGNED NOT NULL,
    code VARCHAR(30) NULL,
    name VARCHAR(120) NOT NULL
);

INSERT INTO subject_seed
    (academic_year_id, semester_number, code, name)
VALUES
    (1, 1, 'CEIT-2001', 'C Programming'),
    (1, 2, 'CEIT-1000', 'Introduction to Computer System'),

    (2, 1, 'CEIT-3011', 'Objective Oriented Programming'),
    (2, 1, 'CEIT-3010', 'Digital Electronics'),
    (2, 1, 'CEIT-3020', 'Engineering Circuit Analysis'),

    (2, 2, 'CEIT-4002', 'Digital Communication'),
    (2, 2, 'CEIT-4021', 'Advanced Java Programming'),
    (2, 2, 'CEIT-4031', 'Database Management System'),
    (2, 2, 'CEIT-4041', 'Data Structure and Algorithm'),

    (3, 1, 'IT-31055', 'Data Structure'),
    (3, 1, 'IT-31022', 'Computer Networks'),
    (3, 1, 'IT-31035', 'Web Development Technologies II'),
    (3, 1, 'IT-31016', 'Database Management System'),
    (3, 1, 'IT-32045', 'Programming Language in Java'),

    (3, 2, 'IT-32055', 'Data Structure'),
    (3, 2, 'IT-32022', 'Computer Networks'),
    (3, 2, 'IT-32035', 'Web Development Technologies II'),
    (3, 2, 'IT-32016', 'Database Management System'),
    (3, 2, 'IT-32045', 'Programming Language in Java'),

    (4, 1, 'IT-41017', 'Modern Control Systems'),
    (4, 1, 'IT-41032', 'Advanced Computer Networks'),
    (4, 1, 'IT-41023', 'Computer Architecture and Organization'),
    (4, 1, 'IT-41033', 'Operating Systems'),
    (4, 1, 'IT-41026', 'Advanced Data Management Techniques'),

    (4, 2, 'IT-42017', 'Modern Control Systems'),
    (4, 2, 'IT-42032', 'Advanced Computer Networks'),
    (4, 2, 'IT-42023', 'Computer Architecture and Organization'),
    (4, 2, 'IT-42033', 'Operating Systems'),
    (4, 2, 'IT-42026', 'Advanced Data Management Techniques'),

    (5, 1, 'IT-51065', 'Software Engineering'),
    (5, 1, 'IT-51043', 'Embedded Systems'),
    (5, 1, 'IT-51014', 'Cloud Computing'),
    (5, 1, 'IT-51027', 'Digital Signal Processing'),
    (5, 1, 'IT-51037', 'Digital Image Processing'),

    (5, 2, 'IT-52047', 'Artificial Intelligence'),
    (5, 2, 'IT-52043', 'Embedded Systems'),
    (5, 2, 'IT-52037', 'Digital Image Processing'),
    (5, 2, 'IT-52065', 'Software Engineering'),
    (5, 2, 'IT-52042', 'Cryptography and Network Security'),

    (6, 1, NULL, 'BigBlueButtonTraining'),
    (6, 1, 'IT-61075', 'Project Management'),
    (6, 1, 'IT-61062', 'Wireless and Mobile Communications'),
    (6, 1, 'IT-61052', 'Network Planning and Management');

INSERT INTO subjects (
    code,
    name,
    year_level,
    semester_id,
    teacher_registration_enabled
)
SELECT
    seed.code,
    seed.name,
    seed.academic_year_id,
    semester.id,
    1
FROM subject_seed seed
JOIN semesters semester
  ON semester.academic_year_id = seed.academic_year_id
 AND semester.semester_number = seed.semester_number
WHERE NOT EXISTS (
    SELECT 1
    FROM subjects existing
    WHERE existing.semester_id = semester.id
      AND (
          (seed.code IS NOT NULL AND existing.code = seed.code)
          OR
          (
              seed.code IS NULL
              AND existing.code IS NULL
              AND existing.name = seed.name
          )
      )
);

DROP TEMPORARY TABLE subject_seed;

ALTER TABLE subjects
    ADD UNIQUE KEY subjects_semester_code_unique (
        semester_id,
        code
    );

ALTER TABLE students
    ADD COLUMN semester_id SMALLINT UNSIGNED NULL AFTER year_level,
    ADD COLUMN class_id INT NULL AFTER class_name,
    ADD KEY students_semester_idx (semester_id),
    ADD KEY students_class_idx (class_id),
    ADD CONSTRAINT students_semester_fk
        FOREIGN KEY (semester_id)
        REFERENCES semesters(id),
    ADD CONSTRAINT students_class_fk
        FOREIGN KEY (class_id)
        REFERENCES classes(id);

-- Class names can be preserved exactly; semester remains unresolved.
UPDATE students student
JOIN classes class
  ON class.name = student.class_name
 AND class.academic_year_id = student.year_level
SET student.class_id = class.id
WHERE student.class_name IS NOT NULL;

CREATE TABLE teacher_terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    teacher_id INT NOT NULL,
    semester_id SMALLINT UNSIGNED NOT NULL,
    class_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY teacher_term_unique (
        teacher_id,
        semester_id,
        class_id
    ),
    CONSTRAINT teacher_terms_teacher_fk
        FOREIGN KEY (teacher_id)
        REFERENCES teachers(id)
        ON DELETE CASCADE,
    CONSTRAINT teacher_terms_semester_fk
        FOREIGN KEY (semester_id)
        REFERENCES semesters(id),
    CONSTRAINT teacher_terms_class_fk
        FOREIGN KEY (class_id)
        REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Infer teacher terms only from an explicit existing subject assignment.
INSERT IGNORE INTO teacher_terms (
    teacher_id,
    semester_id,
    class_id
)
SELECT DISTINCT
    assignment.teacher_id,
    subject.semester_id,
    class.id
FROM teacher_subjects assignment
JOIN teachers teacher
  ON teacher.id = assignment.teacher_id
JOIN subjects subject
  ON subject.id = assignment.subject_id
JOIN semesters semester
  ON semester.id = subject.semester_id
JOIN classes class
  ON class.academic_year_id = semester.academic_year_id
WHERE subject.semester_id IS NOT NULL
  AND FIND_IN_SET(
      UPPER(class.name),
      REPLACE(UPPER(COALESCE(teacher.class_name, '')), ' ', '')
  ) > 0;

ALTER TABLE teacher_subjects
    ADD COLUMN teacher_term_id INT NULL AFTER teacher_id,
    ADD KEY teacher_subjects_term_idx (teacher_term_id),
    ADD KEY teacher_subjects_teacher_idx (teacher_id);

UPDATE teacher_subjects assignment
JOIN subjects subject
  ON subject.id = assignment.subject_id
JOIN teacher_terms term
  ON term.teacher_id = assignment.teacher_id
 AND term.semester_id = subject.semester_id
SET assignment.teacher_term_id = term.id
WHERE subject.semester_id IS NOT NULL;

ALTER TABLE teacher_subjects
    DROP INDEX teacher_subject_unique,
    ADD UNIQUE KEY teacher_term_subject_unique (
        teacher_term_id,
        subject_id
    ),
    ADD CONSTRAINT teacher_subjects_term_fk
        FOREIGN KEY (teacher_term_id)
        REFERENCES teacher_terms(id)
        ON DELETE CASCADE;

ALTER TABLE attendance_sessions
    ADD COLUMN teacher_subject_id INT NULL AFTER subject_id,
    ADD KEY attendance_sessions_teacher_subject_idx (
        teacher_subject_id
    );

UPDATE attendance_sessions session
JOIN teacher_subjects assignment
  ON assignment.teacher_id = session.teacher_id
 AND assignment.subject_id = session.subject_id
SET session.teacher_subject_id = assignment.id;

ALTER TABLE attendance_sessions
    ADD CONSTRAINT attendance_sessions_teacher_subject_fk
        FOREIGN KEY (teacher_subject_id)
        REFERENCES teacher_subjects(id);

-- Verification: these are expected to remain unresolved intentionally.
SELECT id, student_no, class_name, year_level
FROM students
WHERE semester_id IS NULL;

SELECT id, code, name, year_level
FROM subjects
WHERE semester_id IS NULL;

SELECT session.id, session.subject_id, subject.code
FROM attendance_sessions session
JOIN subjects subject ON subject.id = session.subject_id
WHERE session.teacher_subject_id IS NULL
   OR subject.semester_id IS NULL;
