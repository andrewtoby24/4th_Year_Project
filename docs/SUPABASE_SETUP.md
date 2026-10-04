# Supabase setup

## Current EasyAttend deployment

- GitHub repository: `andrewtoby24/4th_Year_Project` (`main`)
- Netlify site: `https://easy-attend-pj.netlify.app`
- Supabase project: `Easy_Attend_PJ_SG` (`pizjdjhhzapsrqpxcjjt`, Singapore)
- Attendance geofence: 100 m around the teacher device's fresh location when each QR session starts

The Supabase GitHub integration is enabled for this repository with `.` as its working directory and production deploys from `main`. New migrations and the `api` Edge Function declared in `supabase/config.toml` deploy when a commit is pushed to `main`. Edge Function secrets are set in the Supabase dashboard and must not be committed.

## Create and connect a project

1. Create a Supabase project and keep its database password private.
2. Install the Supabase CLI, then connect this repository using the project ref:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   npx supabase functions deploy api
   ```

3. Set the Edge Function secrets in the Supabase project:

   ```sh
   npx supabase secrets set \
     APP_ALLOWED_ORIGINS=https://easy-attend-pj.netlify.app \
     ATTENDANCE_RADIUS_METERS=100 \
     ATTENDANCE_MAX_ACCURACY_METERS=100
   ```

   Supabase injects its project URL and secret keys into Edge Functions. Never put the secret key in Netlify or browser code. `APP_ALLOWED_ORIGINS` can contain comma-separated origins if you also need preview URLs.

## Create the first administrator

Public registration only permits student and teacher accounts. Create the first admin directly:

1. In Supabase **Authentication → Users**, create a confirmed user with email `admin@accounts.easyattend.invalid` and a strong password.
2. Copy that user's UUID.
3. In **SQL Editor**, insert their profile:

   ```sql
   insert into public.profiles (id, email, username, full_name, role, status)
   values ('AUTH_USER_UUID', 'admin@accounts.easyattend.invalid', 'admin', 'System Administrator', 'admin', 'active');
   ```

The login form accepts the username `admin` and the password you set. Usernames are converted to private internal Auth addresses; users do not need email addresses. Since those addresses cannot receive mail, password recovery must be handled by an administrator in the Supabase Auth dashboard.

## Deploy the frontend to Netlify

Connect `andrewtoby24/4th_Year_Project` to Netlify. Set the build command to `npm run build`, the publish directory to `dist`, and these build environment variables:

- `VITE_SUPABASE_URL`: the project's **Project URL**
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key (safe for browser use with RLS enabled)

After Netlify assigns a site URL, make sure that exact origin is in the Supabase `APP_ALLOWED_ORIGINS` secret, then redeploy the Edge Function or update the secret. The SQL migration enables RLS on every table; only academic catalog tables are directly readable by browsers. Other operations go through the Edge Function, which checks role and ownership before using the server-side key.

## Local frontend

Set `window.EASYATTEND_SUPABASE_URL` and `window.EASYATTEND_SUPABASE_PUBLISHABLE_KEY` in `web/app-config.js`, then run `npm run dev`. The Edge Function's allowed origins must include `http://localhost:5173` during local development.

When a teacher starts a QR session, the app asks for a fresh, precise location and saves it as that session's attendance center. Students are checked against that saved center and the configured radius. The Edge Function validates the supplied coordinates and accuracy; as with browser geolocation generally, device locations can be inaccurate or spoofed. Camera and GPS access require HTTPS in production.
