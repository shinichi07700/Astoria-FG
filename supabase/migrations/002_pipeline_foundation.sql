-- ============================================================
--  002 - PIPELINE FOUNDATION
--  Master data for the full manufacturing pipeline: customers,
--  formula masters (FFS / FR-RD-09), packaging masters (FPS /
--  FR-PD-02 + SBK ST-PD-01) and the mixer catalogue used by the
--  PPIC lot-sizing engine. Also extends materials with purchasing
--  parameters (MOQ, lead time) and links production BOMs to their
--  formula / packaging masters and customer. Recipe percentages live on
--  bom_lines.pct (the 100% ratio basis); packaging supply ownership reuses
--  the existing bom_lines.supported_by column.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key
--  cannot execute DDL). Idempotent - safe to re-run.
--  Baseline schema = supabase/schema.sql (treat it as migration 001).
-- ============================================================

-- ---------- customers ----------
create table if not exists public.m_customer (
  id         text primary key,            -- customer code, e.g. BN, LG
  name       text not null default '',
  address    text not null default '',
  pic        text not null default '',    -- person in charge
  contact    text not null default '',    -- phone / email
  terms      text not null default '',    -- payment / delivery terms
  updated_at timestamptz not null default now()
);
drop trigger if exists m_customer_touch on public.m_customer;
create trigger m_customer_touch before update on public.m_customer
  for each row execute function public.touch_updated_at();

-- ---------- formula master (FFS, form FR-RD-09) ----------
-- Bulk formulas live on a strict 100% weight-ratio basis; the line
-- percentages are stored on bom_lines of the production BOM and the
-- editor enforces the 100.00% sum.
create table if not exists public.m_formula (
  id          text primary key,           -- FFS code [Kategori]-[Customer]-[Urutan]
  kategori    text not null default '',
  customer_id text references public.m_customer(id) on delete set null,
  urutan      integer not null default 0,
  bj          numeric not null default 1 check (bj > 0),   -- specific gravity
  ph_min      numeric,
  ph_max      numeric,
  viscosity   text not null default '',
  stab_tk     text not null default '-' check (stab_tk     in ('-','Running','Pass','Fail')),  -- room temp
  stab_tkul   text not null default '-' check (stab_tkul   in ('-','Running','Pass','Fail')),  -- refrigerator
  stab_t50    text not null default '-' check (stab_t50    in ('-','Running','Pass','Fail')),  -- oven 50 C
  stab_tm     text not null default '-' check (stab_tm     in ('-','Running','Pass','Fail')),  -- sunlight
  note        text not null default '',
  updated_at  timestamptz not null default now(),
  check (ph_min is null or ph_max is null or ph_max >= ph_min)
);
create index if not exists m_formula_customer_idx on public.m_formula (customer_id);
drop trigger if exists m_formula_touch on public.m_formula;
create trigger m_formula_touch before update on public.m_formula
  for each row execute function public.touch_updated_at();

-- ---------- packaging master (FPS, FR-PD-02 / SBK ST-PD-01) ----------
create table if not exists public.m_packaging (
  id              text primary key,       -- FPS code [Kategori]-[Customer]-[Urutan Varian]-[Revisi]
  customer_id     text references public.m_customer(id) on delete set null,
  urutan_varian   integer not null default 0,
  revisi          integer not null default 0,
  fill_min        numeric not null default 0 check (fill_min >= 0),
  fill_max        numeric not null default 0 check (fill_max >= 0),
  shrink_tunnel_c numeric not null default 0,
  inkjet_syntax   text not null default '',
  note            text not null default '',
  updated_at      timestamptz not null default now(),
  check (fill_max >= fill_min)
);
create index if not exists m_packaging_customer_idx on public.m_packaging (customer_id);
drop trigger if exists m_packaging_touch on public.m_packaging;
create trigger m_packaging_touch before update on public.m_packaging
  for each row execute function public.touch_updated_at();

-- ---------- mixer catalogue (PPIC lot sizing) ----------
create table if not exists public.m_mixer (
  id          text primary key,
  name        text not null default '',
  vessel      text not null default '',
  capacity_kg numeric not null default 0 check (capacity_kg > 0),
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
insert into public.m_mixer (id, name, vessel, capacity_kg) values
  ('MX-HIMIX1000', 'Himix 1,000 kg', 'Himix', 1000),
  ('MX-DJK500', 'Double jacket kettle 500 kg', 'Double jacket kettle', 500),
  ('MX-DJK200', 'Double jacket kettle 200 kg', 'Double jacket kettle', 200)
on conflict (id) do nothing;

-- ---------- purchasing parameters on materials ----------
alter table public.materials add column if not exists moq       numeric not null default 0;
alter table public.materials add column if not exists lead_days integer not null default 0;

-- ---------- production BOM links to its masters ----------
alter table public.boms add column if not exists formula_id   text references public.m_formula(id)   on delete set null;
alter table public.boms add column if not exists packaging_id text references public.m_packaging(id) on delete set null;
create index if not exists boms_formula_idx   on public.boms (formula_id);
create index if not exists boms_packaging_idx on public.boms (packaging_id);

-- ---------- formula recipe ratio + BOM customer link (Phase 1) ----------
-- Each FORMULA line carries its weight-ratio percentage; the editor enforces
-- the section sums to exactly 100.00%. KEMAS supply ownership reuses the
-- existing bom_lines.supported_by enum ('Customer' | 'Astoria').
alter table public.bom_lines add column if not exists pct numeric not null default 0;
alter table public.boms add column if not exists customer_id text references public.m_customer(id) on delete set null;
create index if not exists boms_customer_idx on public.boms (customer_id);
-- backfill the FK from the legacy free-text customer name / code
update public.boms b set customer_id = c.id
  from public.m_customer c
  where b.customer_id is null and coalesce(b.customer, '') <> ''
    and (c.name = b.customer or c.id = b.customer);

-- ---------- RLS: same v1 policy as the baseline (staff read/write) ----------
do $$
declare t text;
begin
  foreach t in array array['m_customer','m_formula','m_packaging','m_mixer'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
