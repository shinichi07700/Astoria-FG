-- ============================================================
--  014 - STAFF EMPLOYEE ID + TEMPORARY-PASSWORD FLAG
--  Two supporting columns for staff-account management on the Master User
--  page (Admin only):
--    emp_id   text     - the person's staff number (reference only)
--    pw_temp  boolean  - true while the account is still on a one-time
--                        password an Admin handed out and has not replaced
--
--  When an Admin resets a forgotten password they generate a RANDOM one-time
--  password (see supabase/create-user.ps1 -ResetPassword) and set pw_temp; the
--  app then blocks the account until its owner chooses a private password. The
--  owner clears pw_temp on their OWN row after a successful PUT /auth/v1/user,
--  which 008's profiles_update already permits (id = auth.uid()). A flag is
--  used instead of inspecting the password because only GoTrue can see the hash.
--
--  emp_id is visible to every signed-in staff member because 008's
--  profiles_select is using (true); it is an internal reference number, no
--  longer a credential. The partial unique index below stops two people
--  sharing one staff number while still allowing the empty string on accounts
--  that have not been given a number yet.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key cannot
--  execute DDL). Idempotent - safe to re-run. Depends on schema.sql.
--  The app tolerates both columns being absent: they are read as
--  undefined and rendered empty until this file is applied.
-- ============================================================

alter table public.profiles add column if not exists emp_id  text    not null default '';
alter table public.profiles add column if not exists pw_temp boolean not null default false;

create unique index if not exists profiles_emp_id_uidx
  on public.profiles (emp_id) where emp_id <> '';
