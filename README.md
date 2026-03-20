# Skill Builder

Vite + React + TypeScript tutor app with Supabase backend.

## Authentication (email / password)

Sign-in uses [Supabase Auth](https://supabase.com/docs/guides/auth) (`signUp` / `signInWithPassword`). Configure your Supabase project:

1. **Authentication → Providers**: enable **Email**. You can turn off **Google** if you no longer use it.
2. **Authentication → URL configuration**: set **Site URL** to your production origin. For local dev, add `http://localhost:5173` (or your Vite port) under **Redirect URLs**.
3. **Confirm email**: If enabled, new users must click the link in email before a session exists. The login page shows a short notice and a toast when signup completes without an immediate session.

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
