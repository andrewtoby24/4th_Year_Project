# AttendQR Backend

## Run

1. Start Apache and MySQL in XAMPP.
2. Import `database/schema.sql` in phpMyAdmin, or run:
   `C:\xampp2\mysql\bin\mysql.exe -u root < database\schema.sql`
3. Open `http://localhost/4th_Year_Pj_Backend/public/index.php?action=health`.

For an existing database, apply migrations in numeric order. Migration `005_attendance_location_audit.sql` adds nullable GPS audit columns to existing attendance records without deleting data. Migration `006_persistent_qr_sessions.sql` adds the explicit session end time and the restorable teacher QR payload required for persistent sessions. Migration `007_academic_year_semester_subjects.sql` adds the academic-year, semester, class, subject-catalog, teacher-term, and assignment relationships while preserving existing IDs and attendance history. It deliberately leaves ambiguous legacy rows unresolved instead of guessing their semester.

The actual post-migration relationships are documented in [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md).

## Attendance location

Temporary local development: `allow_local_development_bypass` in `config/attendance.php` is currently enabled. On the localhost frontend, choose OK in the development prompt to submit `development_location_bypass: true`. PHP accepts this only when the direct connection address is loopback; forwarded headers are not trusted. Authentication, active-session checks, class checks, and duplicate prevention still apply. Bypassed rows have NULL GPS audit fields and the success response explicitly reports the bypass. Set the flag to `false` before deployment, including deployments behind a local reverse proxy. No database migration is needed for this option.

Edit `config/attendance.php` to set the school/classroom latitude, longitude, allowed radius, and maximum accepted browser accuracy. The defaults are latitude `16.8409`, longitude `96.1735`, a `100` meter radius, and maximum accuracy of `100` meters.

Student QR submissions must include `latitude`, `longitude`, and `accuracy`. The API validates the ranges and accuracy, calculates Haversine distance on the server, and inserts attendance only when the reading is inside the configured radius.

The default XAMPP user configuration is in `config/database.php`. Change it if your MySQL root account has a password.

## Login rules

Students are registered to one device using the client device UUID; administrators can clear that registration with `admin/device/reset`. Teacher logins are multi-device: each successful login receives its own API token and does not invalidate a teacher's sessions on other devices. Logging out removes only the current device's token.

## Initial administrator

- Username: `admin`
- Password: `admin123`

Change this password before deploying anywhere beyond local development.

## Implemented API actions

`register`, `login`, `logout`, `me`, `student/profile`, `student/attendance`,
`student/schedule`, `student/scan`, `teacher/assignments`, `attendance/create`, `attendance/active`, `attendance/end`, `attendance/live`,
`attendance/sessions`, `attendance/session`,
`reports/monthly`, `admin/users`, `admin/verify`, `admin/device/reset`,
`admin/subject`, and `subjects`.
