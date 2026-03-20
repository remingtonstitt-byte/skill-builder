# Skill Builder

Vite + React + TypeScript tutor app with Supabase backend.

## Authentication (email / password)

Sign-in uses [Supabase Auth](https://supabase.com/docs/guides/auth) (`signUp` / `signInWithPassword`). Configure your Supabase project:

1. **Authentication → Providers** → **Email**: enable it. Turn **off** **“Confirm email”** / **“Confirm sign up”** (wording varies; you want sign-ups to get a session immediately). If it stays on, new users can look “created” but password sign-in fails until they confirm — delete test users under **Authentication → Users** after changing this. You can turn off **Google** if you no longer use it.
2. **Authentication → URL configuration**: set **Site URL** to your production origin. For local dev, add `http://localhost:5173` (or your Vite port) under **Redirect URLs**.

### Fix: sign-up works but sign-in says wrong password / invalid login

Supabase is often still requiring **email confirmation** even if the toggle looks off.

**Option A — Run the SQL migration (most reliable)**  
1. Supabase **Dashboard** → your project → **SQL Editor** → New query.  
2. Paste the entire file [`supabase/migrations/20260321180000_auto_confirm_email_on_signup.sql`](supabase/migrations/20260321180000_auto_confirm_email_on_signup.sql) and click **Run**.  
3. **Authentication** → **Users** → delete old test users for that email.  
4. Sign up again on the app; you should be able to sign in with the same password.

**Option B — Dashboard only**  
**Authentication** → **Providers** → **Email** → disable **Confirm email** / **email confirmations**, then delete users and sign up again.

Environment variables (optional; see `.env.example`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

If unset, the app uses defaults in [`src/integrations/supabase/public-client-config.ts`](src/integrations/supabase/public-client-config.ts) (anon key + project URL — protect data with Supabase **RLS**). Override env vars when you rotate keys or switch projects.

### Deploying on Vercel

1. Connect this GitHub repo to a Vercel project (import the repo, root directory `.`, framework **Vite**).
2. **Environment variables** are optional because of the embedded public client defaults; add `VITE_SUPABASE_*` in Vercel if you want to override without changing code. Redeploy after changing them.
3. **Redeploy** the latest `main` commit if the live site looks stale.

## Scripts

- `npm run dev` — start dev server  
- `npm run build` — production build  
- `npm run test` — Vitest  

---

Originally scaffolded with Lovable; Google OAuth was removed in favor of email/password via Supabase.
