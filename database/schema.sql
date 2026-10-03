CREATE DATABASE IF NOT EXISTS qr_attendance CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qr_attendance;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  role ENUM('admin','teacher','student') NOT NULL,
  status ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS academic_years (
  id TINYINT UNSIGNED PRIMARY KEY,
  year_level TINYINT UNSIGNED NOT NULL UNIQUE,
  name VARCHAR(30) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO academic_years (id,year_level,name) VALUES
  (1,1,'1st Year'),(2,2,'2nd Year'),(3,3,'3rd Year'),
  (4,4,'4th Year'),(5,5,'5th Year'),(6,6,'6th Year')
ON DUPLICATE KEY UPDATE year_level=VALUES(year_level),name=VALUES(name);

CREATE TABLE IF NOT EXISTS semesters (
  id SMALLINT UNSIGNED PRIMARY KEY,
  academic_year_id TINYINT UNSIGNED NOT NULL,
  semester_number TINYINT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL,
  UNIQUE KEY semester_per_year (academic_year_id,semester_number),
  CONSTRAINT semesters_academic_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO semesters (id,academic_year_id,semester_number,name) VALUES
  (11,1,1,'1st Semester'),(12,1,2,'2nd Semester'),
  (21,2,1,'1st Semester'),(22,2,2,'2nd Semester'),
  (31,3,1,'1st Semester'),(32,3,2,'2nd Semester'),
  (41,4,1,'1st Semester'),(42,4,2,'2nd Semester'),
  (51,5,1,'1st Semester'),(52,5,2,'2nd Semester'),
  (61,6,1,'1st Semester'),(62,6,2,'2nd Semester')
ON DUPLICATE KEY UPDATE academic_year_id=VALUES(academic_year_id),semester_number=VALUES(semester_number),name=VALUES(name);

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_year_id TINYINT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL UNIQUE,
  CONSTRAINT classes_academic_year_fk FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO classes (academic_year_id,name) VALUES
  (1,'1IT'),(2,'2IT'),(3,'3IT'),(4,'4IT'),(4,'4IT1'),(5,'5IT'),(6,'6IT')
ON DUPLICATE KEY UPDATE academic_year_id=VALUES(academic_year_id);

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NULL,
  name VARCHAR(120) NOT NULL,
  year_level TINYINT UNSIGNED NULL,
  semester_id SMALLINT UNSIGNED NULL,
  teacher_registration_enabled TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY subjects_semester_code_unique (semester_id,code),
  KEY subjects_semester_idx (semester_id),
  CONSTRAINT subjects_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subjects (code,name,year_level,semester_id,teacher_registration_enabled) VALUES
  ('CEIT-2001','C Programming',1,11,1),
  ('CEIT-1000','Introduction to Computer System',1,12,1),
  ('CEIT-3011','Objective Oriented Programming',2,21,1),
  ('CEIT-3010','Digital Electronics',2,21,1),
  ('CEIT-3020','Engineering Circuit Analysis',2,21,1),
  ('CEIT-4002','Digital Communication',2,22,1),
  ('CEIT-4021','Advanced Java Programming',2,22,1),
  ('CEIT-4031','Database Management System',2,22,1),
  ('CEIT-4041','Data Structure and Algorithm',2,22,1),
  ('IT-31055','Data Structure',3,31,1),
  ('IT-31022','Computer Networks',3,31,1),
  ('IT-31035','Web Development Technologies II',3,31,1),
  ('IT-31016','Database Management System',3,31,1),
  ('IT-32045','Programming Language in Java',3,31,1),
  ('IT-32055','Data Structure',3,32,1),
  ('IT-32022','Computer Networks',3,32,1),
  ('IT-32035','Web Development Technologies II',3,32,1),
  ('IT-32016','Database Management System',3,32,1),
  ('IT-32045','Programming Language in Java',3,32,1),
  ('IT-41017','Modern Control Systems',4,41,1),
  ('IT-41032','Advanced Computer Networks',4,41,1),
  ('IT-41023','Computer Architecture and Organization',4,41,1),
  ('IT-41033','Operating Systems',4,41,1),
  ('IT-41026','Advanced Data Management Techniques',4,41,1),
  ('IT-42017','Modern Control Systems',4,42,1),
  ('IT-42032','Advanced Computer Networks',4,42,1),
  ('IT-42023','Computer Architecture and Organization',4,42,1),
  ('IT-42033','Operating Systems',4,42,1),
  ('IT-42026','Advanced Data Management Techniques',4,42,1),
  ('IT-51065','Software Engineering',5,51,1),
  ('IT-51043','Embedded Systems',5,51,1),
  ('IT-51014','Cloud Computing',5,51,1),
  ('IT-51027','Digital Signal Processing',5,51,1),
  ('IT-51037','Digital Image Processing',5,51,1),
  ('IT-52047','Artificial Intelligence',5,52,1),
  ('IT-52043','Embedded Systems',5,52,1),
  ('IT-52037','Digital Image Processing',5,52,1),
  ('IT-52065','Software Engineering',5,52,1),
  ('IT-52042','Cryptography and Network Security',5,52,1),
  ('IT-61075','Project Management',6,61,1),
  ('IT-61062','Wireless and Mobile Communications',6,61,1),
  ('IT-61052','Network Planning and Management',6,61,1)
ON DUPLICATE KEY UPDATE name=VALUES(name),year_level=VALUES(year_level),teacher_registration_enabled=VALUES(teacher_registration_enabled);

INSERT INTO subjects (code,name,year_level,semester_id,teacher_registration_enabled)
SELECT NULL,'BigBlueButtonTraining',6,61,1
WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE semester_id=61 AND code IS NULL AND name='BigBlueButtonTraining');

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  student_no VARCHAR(50) UNIQUE,
  class_name VARCHAR(30) NULL,
  class_id INT NULL,
  year_level TINYINT UNSIGNED NULL,
  semester_id SMALLINT UNSIGNED NULL,
  device_uuid VARCHAR(100) NULL,
  KEY students_semester_idx (semester_id),
  KEY students_class_idx (class_id),
  CONSTRAINT students_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT students_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters(id),
  CONSTRAINT students_class_fk FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  staff_no VARCHAR(50) UNIQUE,
  class_name VARCHAR(30) NULL,
  subject_id INT NULL,
  subject_code VARCHAR(30) NULL,
  year_level TINYINT UNSIGNED NULL,
  CONSTRAINT teachers_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT teachers_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_terms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  semester_id SMALLINT UNSIGNED NOT NULL,
  class_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY teacher_term_unique (teacher_id,semester_id,class_id),
  CONSTRAINT teacher_terms_teacher_fk FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT teacher_terms_semester_fk FOREIGN KEY (semester_id) REFERENCES semesters(id),
  CONSTRAINT teacher_terms_class_fk FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  teacher_term_id INT NULL,
  subject_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY teacher_term_subject_unique (teacher_term_id,subject_id),
  KEY teacher_subjects_teacher_idx (teacher_id),
  CONSTRAINT teacher_subjects_teacher_fk FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT teacher_subjects_term_fk FOREIGN KEY (teacher_term_id) REFERENCES teacher_terms(id) ON DELETE CASCADE,
  CONSTRAINT teacher_subjects_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS classrooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subject_id INT NOT NULL,
  teacher_id INT NOT NULL,
  classroom_id INT NULL,
  day_of_week VARCHAR(12) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CONSTRAINT schedules_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT schedules_teacher_fk FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT schedules_classroom_fk FOREIGN KEY (classroom_id) REFERENCES classrooms(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  subject_id INT NOT NULL,
  teacher_subject_id INT NULL,
  year_level TINYINT UNSIGNED NULL,
  class_name VARCHAR(30) NULL,
  schedule_id INT NULL,
  title VARCHAR(160) NOT NULL,
  starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  ended_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  KEY attendance_sessions_teacher_subject_idx (teacher_subject_id),
  CONSTRAINT sessions_teacher_fk FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT sessions_subject_fk FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT sessions_assignment_fk FOREIGN KEY (teacher_subject_id) REFERENCES teacher_subjects(id),
  CONSTRAINT sessions_schedule_fk FOREIGN KEY (schedule_id) REFERENCES schedules(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS qr_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  display_token VARCHAR(100) NULL,
  expires_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT qr_codes_session_fk FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  status ENUM('present','absent','late') NOT NULL DEFAULT 'present',
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  accuracy DECIMAL(8,2) NULL,
  distance_from_classroom DECIMAL(10,2) NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY one_record_per_session (session_id,student_id),
  CONSTRAINT attendance_session_fk FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT attendance_student_fk FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message VARCHAR(255) NOT NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT notifications_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT api_tokens_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO users (id,username,password_hash,full_name,role,status)
VALUES (1,'admin','$2y$10$dJS36qo4BQbAIK30HteQ8.jR2gjHHiVz7kHAqQvf0LNwkuo0BUqjC','System Administrator','admin','active');
