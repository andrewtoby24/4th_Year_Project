# API Usage

All API requests go to `public/index.php?action={action}`. Send JSON bodies and include browser cookies (`credentials: 'include'`) or a Bearer token returned from login.

`GET registration/subjects` returns `academic_years`, `semesters`, `classes`, and selectable `subjects`. Each subject carries its academic-year and semester IDs so clients can implement dependent dropdowns.

`POST register` accepts `full_name`, `username`, `password`, and `role`. Students send their unchanged roll number as `identifier` (for example, `4IT15`), plus `academic_year_id` and `semester_id`; the roll-number prefix must match the selected academic year, while semester is stored separately. Teachers send comma-separated `class_names` (for example, `4IT,3IT`), `semester_number` (`1` or `2`), and `subject_ids[]`. `IT4,IT3` input is accepted and normalized to the existing `4IT,3IT` class names. The API resolves the year-specific semester ID for every entered class, verifies every subject against those classes and the selected semester, and creates one teacher term per class. The older single-term teacher fields (`academic_year_id`, `semester_id`, and `class_id`) remain supported for existing clients.

`POST login` accepts `username`, `password`, and a `device_uuid` for student accounts. Students are bound to their first registered device and a new student login replaces that device's previous token. Every teacher login creates an independent token, so teachers may stay signed in on multiple devices simultaneously. Logging out revokes only the token from the device making that request.

`POST teacher/assignments` accepts `academic_year_id`, `semester_id`, `class_id`, and `subject_ids[]`. It creates or updates one teacher term. Assignments with attendance history cannot be removed.

Teachers use `attendance/create` with `title` and `teacher_subject_id`. The API validates that the assignment belongs to the authenticated teacher and derives the exact class, academic year, semester, and subject from it. A teacher can have only one active QR session; the API returns `ACTIVE_SESSION_EXISTS` until that session is explicitly ended.

`GET attendance/active` restores the teacher's current active session and QR payload. `POST attendance/end` accepts the current `session_id`, marks that session and its QR code inactive, and records `ended_at`. `GET attendance/live` returns the current active session (or the most recently ended session), full attendance totals, and only the latest three rows for the compact QR-page display. Attendance rows are never removed by this display limit.

`GET ?action=attendance/sessions&teacher_subject_id={id}` returns every session for one exact teacher/term/subject assignment, newest first, including backend-confirmed `ACTIVE` or `ENDED` status and start/end timestamps. `GET ?action=attendance/session&session_id={id}` returns only stored attendance submissions for that teacher-owned session. Active sessions return the latest three rows for live display; ended sessions return the complete submission list with database `recorded_at` timestamps.

Students submit `token`, `latitude`, `longitude`, and `accuracy` to `student/scan`. The API resolves the session context, requires the session and QR code to remain active, validates the student's class, year, and semester, rejects missing or invalid location data, rejects poor accuracy, calculates Haversine distance against `config/attendance.php`, and prevents duplicate records. A successful response has `code: SUCCESS`. Location/scan failures use codes such as `LOCATION_PERMISSION_REQUIRED`, `LOCATION_UNAVAILABLE`, `POOR_LOCATION_ACCURACY`, `INVALID_COORDINATES`, `OUTSIDE_ALLOWED_AREA`, `SESSION_ENDED`, and `DUPLICATE_ATTENDANCE` with an appropriate non-2xx HTTP status. `LOCATION_UNAVAILABLE` is normally produced by the browser before it can send a request.

`reports/monthly` returns attended sessions, total conducted sessions, and the calculated percentage. Teacher requests use `teacher_subject_id`; the API scopes sessions and students to that assignment's subject, semester, and class. Rows below the 75% requirement include `highlight_red: true` for dynamic UI highlighting.

Administrators may approve accounts with `admin/verify`, enable or disable non-admin accounts with `admin/status` (`user_id`, `status`), and reset a student's device with `admin/device/reset`.
