-- Performance indexes for hot query columns
-- attendance_sessions: teacher queries filter by teacher_id + active
create index if not exists attendance_sessions_teacher_active_idx
  on public.attendance_sessions(teacher_id, active);

-- attendance_sessions: subject assignment lookups
create index if not exists attendance_sessions_subject_id_idx
  on public.attendance_sessions(teacher_subject_id);

-- attendance_sessions: time-range queries for monthly reports
create index if not exists attendance_sessions_starts_at_idx
  on public.attendance_sessions(starts_at);

-- students: user_id is the primary lookup key in almost every student endpoint
create index if not exists students_user_id_idx
  on public.students(user_id);

-- students: class+semester filter for attendance matching
create index if not exists students_class_semester_idx
  on public.students(class_id, semester_id);

-- attendance: student lookup for history and reports
create index if not exists attendance_student_id_idx
  on public.attendance(student_id);

-- teacher_subjects: term lookup
create index if not exists teacher_subjects_term_idx
  on public.teacher_subjects(teacher_term_id);

-- teacher_terms: teacher lookup
create index if not exists teacher_terms_teacher_idx
  on public.teacher_terms(teacher_id);
