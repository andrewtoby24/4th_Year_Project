# AttendQR Backend

## Run locally

1. Start Apache and MySQL in XAMPP.
2. Import `database/schema.sql` in phpMyAdmin, or run:
   `C:\xampp2\mysql\bin\mysql.exe -u root < database\schema.sql`
3. Open `http://localhost/4th_Year_Pj_Backend/public/index.php?action=health`.

For an existing database, apply migrations in numeric order. Migration `005_attendance_location_audit.sql` adds nullable GPS audit columns to existing attendance records without deleting data. Migration `006_persistent_qr_sessions.sql` adds the explicit session end time and the restorable teacher QR payload required for persistent sessions. Migration `007_academic_year_semester_subjects.sql` adds the academic-year, semester, class, subject-catalog, teacher-term, and assignment relationships while preserving existing IDs and attendance history. It deliberately leaves ambiguous legacy rows unresolved instead of guessing their semester.

## Web frontend

The EasyAttend web frontend is in `web/`. It provides admin, teacher, and student views and calls this API. Set `VITE_API_BASE_URL` to the full URL of the deployed API entry point, for example `https://api.example.com/index.php`, then build with `npm run build`. Netlify uses the included `netlify.toml` to publish `dist/` and can redeploy when changes are pushed to GitHub. The PHP API and MySQL database must be hosted separately; Netlify is only hosting the static frontend here.

For local frontend development, edit `web/app-config.js` and set `window.EASYATTEND_API_BASE_URL` to `http://localhost/4th_Year_Project_Back/public/index.php`, then run `npm run dev`. The API permits localhost origins by default. API access uses a bearer token; no cross-site cookies are required.

### Deploy the API

The included `Dockerfile` packages the PHP API for a PHP-capable container host. Provision a managed MySQL database, import `database/schema.sql` for a fresh database (or apply the migrations in order), and configure the API host with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Set `APP_ALLOWED_ORIGINS` to the exact Netlify site origin (and any preview/local origins you need), such as `https://your-site.netlify.app`. Set `ATTENDANCE_LATITUDE`, `ATTENDANCE_LONGITUDE`, `ATTENDANCE_RADIUS_METERS`, and `ATTENDANCE_MAX_ACCURACY_METERS` for the actual campus point and policy. The local bypass is disabled by default; keep `ATTENDANCE_ALLOW_LOCAL_BYPASS=false` in production. Use HTTPS for the frontend and API.

After the API is reachable, configure `VITE_API_BASE_URL` in Netlify's build environment variables and trigger a new deploy. Verify `?action=health`, sign in, and make a student QR check-in from a phone physically inside the configured radius. The browser must be served over HTTPS for camera and location access.

Before opening the site publicly, change the seeded administrator password (`admin` / `admin123`) and do not commit production secrets. Review the real Netlify site origin in `APP_ALLOWED_ORIGINS`; CORS now rejects other origins.

The actual post-migration relationships are documented in [`docs/ER_DIAGRAM.md`](docs/ER_DIAGRAM.md).

## Attendance location

For local development, `ATTENDANCE_ALLOW_LOCAL_BYPASS` defaults to `false`, so GPS verification stays on unless you explicitly enable the bypass. When enabled, PHP accepts a bypass only for direct loopback requests; forwarded headers are not trusted. Authentication, active-session checks, class checks, and duplicate prevention still apply. Bypassed rows have NULL GPS audit fields and the success response explicitly reports the bypass. Keep the option `false` in production. No database migration is needed for this option.

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
