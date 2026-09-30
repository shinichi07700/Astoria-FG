-- ============================================================
--  014 - STAFF EMPLOYEE ID + TEMPORARY-PASSWORD FLAG
--  The Master User page (Admin only) can now hand a forgotten password
--  back, and the value it hands back is the person's employee ID, so
--  that ID has to live in the database:
--    emp_id   text     - staff number, and the temporary password
--    pw_temp  boolean  - true while the account is still using it
--
--  Why a flag instead of comparing the password: only GoTrue can see
--  the hash and the app never asks it "is this still the default?".
--  Whoever performs the reset sets pw_temp; the client clears it on its
--  OWN row after a successful PUT /auth/v1/user, which 008's
--  profiles_update already permits (id = auth.uid()).
--
--  emp_id is visible to every signed-in staff member because 008's
--  profiles_select is using (true). Treat the number as internal - it is
--  also a password until its owner changes it once. The partial unique
--  index below stops two people sharing one ID (and therefore one
--  password) while still allowing the empty string on accounts that have
--  not been given a number yet.
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
