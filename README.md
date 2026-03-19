# Skill Builder

Vite + React + TypeScript tutor app with Supabase backend.

## Authentication (email / password)

Sign-in uses [Supabase Auth](https://supabase.com/docs/guides/auth) (`signUp` / `signInWithPassword`). Configure your Supabase project:

1. **Authentication → Providers**: enable **Email**. You can turn off **Google** if you no longer use it.
2. **Authentication → URL configuration**: set **Site URL** to your production origin. For local dev, add `http://localhost:5173` (or your Vite port) under **Redirect URLs**.
3. **Confirm email**: If enabled, new users must click the link in email before a session exists. The login page shows a short notice and a toast when signup completes without an immediate session.

Environment variables (see `.env`):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Scripts

- `npm run dev` — start dev server  
- `npm run build` — production build  
- `npm run test` — Vitest  

---

Originally scaffolded with Lovable; Google OAuth was removed in favor of email/password via Supabase.
