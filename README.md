# EasyAttend

EasyAttend is a QR based attendance system for students, teachers, and administrators.

- Teachers create attendance sessions and show an active QR code.
- Students scan the QR and submit their location. The server checks the active session, class and semester, GPS accuracy, and distance from the configured campus point (100 m by default).
- Teachers manage class and subject assignments and review attendance.
- Administrators approve accounts, manage users and devices, and maintain the subject catalog.

The web app uses Supabase Auth, PostgreSQL, and a Supabase Edge Function API. The frontend is deployed on Netlify. Student and teacher accounts use username and password; new accounts wait for administrator approval. Username-based Auth uses private internal addresses that cannot receive email, so an administrator must handle password resets.

## Set up and deploy

Follow [the Supabase and Netlify setup guide](docs/SUPABASE_SETUP.md). It covers creating the Supabase project, applying the database migration, deploying the API, creating the first administrator, and configuring Netlify.

Netlify build settings:

- Build command: `npm run build`
- Publish directory: `dist`
- `VITE_SUPABASE_URL`: Supabase Project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable key

Never put the Supabase secret key in frontend configuration. Configure the actual campus coordinates in the Edge Function secrets before using location checks.

## Local frontend development

Set `window.EASYATTEND_SUPABASE_URL` and `window.EASYATTEND_SUPABASE_PUBLISHABLE_KEY` in `web/app-config.js`, allow `http://localhost:5173` in the Edge Function's `APP_ALLOWED_ORIGINS`, then run:

```sh
npm run dev
```
