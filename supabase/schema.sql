-- ============================================================
--  PT ASTORIA PRIMA - F/G Master & BOM Suite
--  Supabase schema. Run ONCE in: Supabase Dashboard > SQL Editor
--  Then create staff accounts in: Authentication > Users
--  (or let users sign up if you enable public sign-up).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles: one row per auth user ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'PPIC',
  email      text not null default '',
  updated_at timestamptz not null default now()
);

-- auto-create a profile whenever an auth user appears
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email,''), '@', 1)),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- updated_at helper ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- Master F/G (the old Google Sheet columns A..J) ----------
create table if not exists public.fg_master (
  id           text primary key,          -- ffs|fps
  ffs          text not null default '',
  fps          text not null default '',
  deskripsi    text not null default '',
  kode_na      text not null default '',
  tgl_expire   text not null default '',  -- yyyy-mm-dd
  discontinue  boolean not null default false,
  kode_fg      text not null default '',  -- derived (col A)
  status       text not null default '',  -- derived (col C)
  diubah_oleh  text not null default '',
  waktu_update text not null default '',
  updated_at   timestamptz not null default now()
);
create index if not exists fg_master_status_idx on public.fg_master (status);
create index if not exists fg_master_kode_idx   on public.fg_master (kode_fg);
drop trigger if exists fg_master_touch on public.fg_master;
create trigger fg_master_touch before update on public.fg_master
  for each row execute function public.touch_updated_at();

-- ---------- Master Material ----------
create table if not exists public.materials (
  code      text primary key,
  name      text not null default '',
  category  text not null default '',     -- RM | PM | AX
  unit      text not null default '',
  stock_qty numeric not null default 0,
  stocked   boolean not null default true,
  supplier  text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists materials_cat_idx on public.materials (category);
drop trigger if exists materials_touch on public.materials;
create trigger materials_touch before update on public.materials
  for each row execute function public.touch_updated_at();

-- ---------- Bill of Material: header + lines ----------
create table if not exists public.boms (
  id            text primary key,
  no_bom        text not null default '',
  fg_id         text not null default '',
  revision      integer not null default 0,
  mulai_berlaku text not null default '',
  customer      text not null default '',
  no_customer   text not null default '',
  bulk_code     text not null default '',
  batch_size    text not null default '',
  batch_yield   numeric not null default 0,
  status        text not null default '',
  updated_at    timestamptz not null default now()
);
create index if not exists boms_fg_idx on public.boms (fg_id);
drop trigger if exists boms_touch on public.boms;
create trigger boms_touch before update on public.boms
  for each row execute function public.touch_updated_at();

create table if not exists public.bom_lines (
  id            bigint generated always as identity primary key,
  bom_id        text not null references public.boms(id) on delete cascade,
  sort          integer not null default 0,
  section       text not null default 'FORMULA',   -- FORMULA | KEMAS
  material_code text not null default '',
  qty_per_unit  numeric not null default 0,
  qty_per_batch numeric not null default 0,
  unit          text not null default '',
  supported_by  text not null default '',
  loss_pct      numeric not null default 0,
  note          text not null default ''
);
create index if not exists bom_lines_bom_idx on public.bom_lines (bom_id);

-- ---------- Simulations & MR/PR documents (immutable, jsonb payload) ----------
create table if not exists public.sims (
  id         text primary key,
  no_sim     text not null default '',
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.requests (
  id         text primary key,
  type       text not null default 'MR',   -- MR | PR
  no_doc     text not null default '',
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- Audit trail (append-only in practice) ----------
create table if not exists public.audit_log (
  id         bigint generated always as identity primary key,
  ts         text not null default '',     -- WIB timestamp string
  user_name  text not null default '',
  role       text not null default '',
  action     text not null default '',
  entity     text not null default '',
  detail     text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists audit_created_idx on public.audit_log (created_at desc);

-- ---------- App meta: document sequences & settings ----------
create table if not exists public.meta_kv (
  key        text primary key,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
drop trigger if exists meta_kv_touch on public.meta_kv;
create trigger meta_kv_touch before update on public.meta_kv
  for each row execute function public.touch_updated_at();

-- ============================================================
--  ROW LEVEL SECURITY
--  v1 policy: every signed-in staff account can read and write
--  the business tables. Role-based field ownership (Regulatory
--  owns NA columns, RND Formula owns formula codes, ...) is
--  enforced in the app UI today.
--  To harden later, replace the write policies per role, e.g.:
--    create policy fg_write_regulatory on public.fg_master
--      for update to authenticated
--      using ((select role from public.profiles where id = auth.uid()) in ('Regulatory','PPIC','QA'))
--      with check (true);
-- ============================================================
alter table public.profiles   enable row level security;
alter table public.fg_master  enable row level security;
alter table public.materials  enable row level security;
alter table public.boms       enable row level security;
alter table public.bom_lines  enable row level security;
alter table public.sims       enable row level security;
alter table public.requests   enable row level security;
alter table public.audit_log  enable row level security;
alter table public.meta_kv    enable row level security;

-- profiles: everyone signed in can read; each user manages own row
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- business tables: full access for signed-in staff
do $$
declare t text;
begin
  foreach t in array array['fg_master','materials','boms','bom_lines','sims','requests','meta_kv'] loop
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- audit: readable by staff, append-only (no update/delete policies)
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (true);
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated with check (true);
