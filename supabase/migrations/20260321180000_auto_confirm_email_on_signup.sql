-- Auto-confirm email for new auth users so password sign-in works immediately.
-- Use when "Confirm email" in the dashboard is ON (or stuck) and sign-up + sign-in fails.
--
-- Apply: Supabase Dashboard → SQL Editor → New query → paste this file → Run.
-- Or: supabase db push (with this repo linked to your Supabase project)
--
-- After running: delete test users under Authentication → Users, then sign up again.

create or replace function public.auto_confirm_email_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  update auth.users
  set email_confirmed_at = timezone('utc'::text, now())
  where id = new.id
    and email_confirmed_at is null;
  return new;
end;
$$;

drop trigger if exists auto_confirm_email_on_signup on auth.users;

create trigger auto_confirm_email_on_signup
  after insert on auth.users
  for each row
  execute function public.auto_confirm_email_on_signup();
