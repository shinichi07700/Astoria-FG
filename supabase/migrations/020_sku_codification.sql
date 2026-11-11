-- ============================================================
--  020 - FG SKU 13-CHAR CODIFICATION
--  Brand master, formula dosage form, FPS revision, FG segment
--  columns + unique business code. Additive only; legacy rows keep
--  their ffs|fps id and old kode_fg until recoded in-app.
--
--  m_brand follows the CURRENT master pattern (role-guarded writes,
--  like m_customer since 008): read open to all staff, writes for
--  Admin + Marketing per rbac.js MASTER_EDITORS.brands.
--  The fg_master column-ownership guard is re-emitted with the three
--  new link columns (brand_id / formula_id / packaging_id); segment
--  columns are derived/frozen like kode_fg and stay unguarded.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor. Idempotent.
--  sync.js tolerates the columns being absent (has020 drift probe),
--  so the app keeps working before this migration is applied.
-- ============================================================

create table if not exists public.m_brand (
  id          text primary key check (id ~ '^[A-Z]{3}$'),
  name        text not null default '',
  customer_id text references public.m_customer(id) on delete set null,
  updated_at  timestamptz not null default now()
);
drop trigger if exists m_brand_touch on public.m_brand;
create trigger m_brand_touch before update on public.m_brand
  for each row execute function public.touch_updated_at();

alter table public.m_brand enable row level security;
drop policy if exists staff_all on public.m_brand;
drop policy if exists m_brand_read on public.m_brand;
create policy m_brand_read on public.m_brand for select to authenticated using (true);
drop policy if exists m_brand_insert on public.m_brand;
create policy m_brand_insert on public.m_brand for insert to authenticated
  with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_brand_update on public.m_brand;
create policy m_brand_update on public.m_brand for update to authenticated
  using (public.auth_role() = any (array['Admin', 'Marketing']))
  with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_brand_delete on public.m_brand;
create policy m_brand_delete on public.m_brand for delete to authenticated
  using (public.auth_role() = any (array['Admin', 'Marketing']));

alter table public.m_formula   add column if not exists dosage_form text not null default ''
  check (dosage_form in ('','LQ','CR','SS','LP','CP','LS','ST'));
alter table public.m_packaging add column if not exists revisi integer not null default 1
  check (revisi between 1 and 99);

alter table public.fg_master add column if not exists brand_id     text references public.m_brand(id)     on delete restrict;
alter table public.fg_master add column if not exists formula_id   text references public.m_formula(id)   on delete restrict;
alter table public.fg_master add column if not exists packaging_id text references public.m_packaging(id) on delete restrict;
alter table public.fg_master add column if not exists app         text not null default '';
alter table public.fg_master add column if not exists form        text not null default '';
alter table public.fg_master add column if not exists seq         integer not null default 0;
alter table public.fg_master add column if not exists size_letter text not null default '';
alter table public.fg_master add column if not exists netto_ml    numeric not null default 0;
alter table public.fg_master add column if not exists rev         integer not null default 0;
alter table public.fg_master add column if not exists legacy_code text not null default '';
drop index if exists public.fg_master_kode_idx;
create unique index if not exists fg_master_kode_uq on public.fg_master (kode_fg);

-- ---------- fg_master column-ownership guard (008 + 020 link columns) ----------
create or replace function public.fg_master_column_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.auth_role();
begin
  if r is null or r = 'Admin' then return new; end if;
  if (new.ffs is distinct from old.ffs) and not (r = any (array['Admin', 'RND Formula', 'Regulatory'])) then
    raise exception 'fg_master.ffs is owned by RND Formula / Regulatory (current role: %)', r;
  end if;
  if (new.fps is distinct from old.fps) and not (r = any (array['Admin', 'RND Kemas'])) then
    raise exception 'fg_master.fps is owned by RND Kemas (current role: %)', r;
  end if;
  if (new.deskripsi is distinct from old.deskripsi) and not (r = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) then
    raise exception 'fg_master.deskripsi is owned by RND Formula / RND Kemas / Regulatory (current role: %)', r;
  end if;
  if (new.kode_na is distinct from old.kode_na) and not (r = any (array['Admin', 'Regulatory'])) then
    raise exception 'fg_master.kode_na is owned by Regulatory (current role: %)', r;
  end if;
  if (new.tgl_expire is distinct from old.tgl_expire) and not (r = any (array['Admin', 'Regulatory'])) then
    raise exception 'fg_master.tgl_expire is owned by Regulatory (current role: %)', r;
  end if;
  if (new.discontinue is distinct from old.discontinue) and not (r = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) then
    raise exception 'fg_master.discontinue is owned by RND Formula / RND Kemas / Regulatory (current role: %)', r;
  end if;
  if (new.brand_id is distinct from old.brand_id) and not (r = any (array['Admin', 'Marketing'])) then
    raise exception 'fg_master.brand_id is owned by Marketing (current role: %)', r;
  end if;
  if (new.formula_id is distinct from old.formula_id) and not (r = any (array['Admin', 'RND Formula', 'Regulatory'])) then
    raise exception 'fg_master.formula_id is owned by RND Formula / Regulatory (current role: %)', r;
  end if;
  if (new.packaging_id is distinct from old.packaging_id) and not (r = any (array['Admin', 'RND Kemas'])) then
    raise exception 'fg_master.packaging_id is owned by RND Kemas (current role: %)', r;
  end if;
  return new;
end $$;
drop trigger if exists fg_master_column_guard on public.fg_master;
create trigger fg_master_column_guard before update on public.fg_master
  for each row execute function public.fg_master_column_guard();