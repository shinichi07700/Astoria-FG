-- ============================================================
--  NEW-PROJECT BOOTSTRAP (generated 2026-10-07)
--  One-paste setup for project txruugumfhnnqimvrmsp.
--  Concatenation of, in order:
--    1. schema.sql                      (baseline = migration 001)
--    2. apply-002-to-013.sql            (combined migrations)
--    3. migrations/014_staff_emp_id.sql (emp_id + pw_temp)
--  Every file is idempotent - safe to re-run. Source of truth
--  stays in schema.sql and supabase/migrations/.
-- ============================================================

-- ========== PART 1/3: schema.sql ==========
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
  category  text not null default '',     -- RM-INT | RM-EXT | PKG-INT | PKG-EXT | PREMIX | AUX-QA (legacy RM|PM|AX still tolerated)
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

-- ========== PART 2/3: apply-002-to-013.sql ==========
/* GENERATED helper - paste once in Supabase SQL Editor. Source of truth stays in supabase/migrations/. Do not edit here. */

-- ========== SOURCE: 002_pipeline_foundation.sql ==========
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

-- ========== SOURCE: 003_sales_order_netting.sql ==========
-- ============================================================
--  003 - SALES ORDER + PPIC NETTING OUTPUT
--  Transaction tables for Phase 2 of the pipeline:
--    t_sales_order    (FR-MK-03) - Marketing sales order, the demand
--                     signal that drives PPIC netting. Status machine
--                     Draft -> Confirmed -> Closed (rbac.js salesOrder).
--    t_purchase_req   (FR-PP-11) - line-level purchase requisition for
--                     Astoria-supplied shortfalls, qty rounded UP to MOQ.
--    t_calloff        - line-level call-off for customer-supplied
--                     components, required-by = delivery - lead time.
--    t_work_order_bulk- mixer-sized bulk batches; rows sharing a
--                     campaign_no form the parent campaign work order.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key
--  cannot execute DDL). Idempotent - safe to re-run.
--  Depends on 002 (m_customer, m_mixer) and the baseline schema
--  (fg_master). Until it runs the app keeps these rows queued
--  locally (sync.js tolerates the missing tables).
-- ============================================================

-- ---------- sales order (FR-MK-03) ----------
create table if not exists public.t_sales_order (
  id             text primary key,
  no_so          text not null default '',
  customer_id    text references public.m_customer(id) on delete set null,
  fg_id          text references public.fg_master(id)  on delete restrict,
  kode_barang  text not null default '',           -- customer article code
  netto_per_unit numeric not null default 0 check (netto_per_unit >= 0),  -- kg / pcs
  order_qty      numeric not null default 0 check (order_qty > 0),
  delivery_date  date,
  status         text not null default 'Draft' check (status in ('Draft','Confirmed','Closed')),
  note           text not null default '',
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists t_sales_order_customer_idx on public.t_sales_order (customer_id);
create index if not exists t_sales_order_fg_idx       on public.t_sales_order (fg_id);
create index if not exists t_sales_order_status_idx   on public.t_sales_order (status);
drop trigger if exists t_sales_order_touch on public.t_sales_order;
create trigger t_sales_order_touch before update on public.t_sales_order
  for each row execute function public.touch_updated_at();

-- ---------- purchase requisition lines (FR-PP-11) ----------
-- One row per material line; rows sharing a req_no form one requisition.
create table if not exists public.t_purchase_req (
  id            text primary key,
  req_no        text not null default '',
  so_id         text references public.t_sales_order(id) on delete set null,
  fg_id         text references public.fg_master(id)     on delete set null,
  material_code text not null default '',
  material_name text not null default '',
  qty           numeric not null default 0,             -- MOQ-rounded order qty
  net_qty       numeric not null default 0,             -- raw net requirement
  unit          text not null default '',
  moq           numeric not null default 0,
  supplier      text not null default '',
  required_by   date,
  status        text not null default 'Open' check (status in ('Open','Ordered','Cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_purchase_req_so_idx     on public.t_purchase_req (so_id);
create index if not exists t_purchase_req_no_idx     on public.t_purchase_req (req_no);
create index if not exists t_purchase_req_mat_idx    on public.t_purchase_req (material_code);
create index if not exists t_purchase_req_status_idx on public.t_purchase_req (status);
drop trigger if exists t_purchase_req_touch on public.t_purchase_req;
create trigger t_purchase_req_touch before update on public.t_purchase_req
  for each row execute function public.touch_updated_at();

-- ---------- customer call-off lines ----------
-- One row per customer-supplied component; rows sharing a call_off_no
-- form one call-off instruction to the customer.
create table if not exists public.t_calloff (
  id            text primary key,
  call_off_no   text not null default '',
  so_id         text references public.t_sales_order(id) on delete set null,
  fg_id         text references public.fg_master(id)     on delete set null,
  customer_id   text references public.m_customer(id)    on delete set null,
  material_code text not null default '',
  material_name text not null default '',
  qty           numeric not null default 0,
  unit          text not null default '',
  required_by   date,
  status        text not null default 'Open' check (status in ('Open','Sent','Received','Cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_calloff_so_idx     on public.t_calloff (so_id);
create index if not exists t_calloff_no_idx     on public.t_calloff (call_off_no);
create index if not exists t_calloff_status_idx on public.t_calloff (status);
drop trigger if exists t_calloff_touch on public.t_calloff;
create trigger t_calloff_touch before update on public.t_calloff
  for each row execute function public.touch_updated_at();

-- ---------- bulk work order (mixer-sized campaign batches) ----------
-- One row per planned batch; rows sharing a campaign_no are the parent
-- campaign work order emitted by the PPIC lot-sizing engine.
create table if not exists public.t_work_order_bulk (
  id          text primary key,
  wo_no       text not null default '',
  campaign_no text not null default '',
  so_id       text references public.t_sales_order(id) on delete set null,
  fg_id       text references public.fg_master(id)     on delete set null,
  bulk_code   text not null default '',
  mixer_id    text references public.m_mixer(id)       on delete set null,
  batch_seq   integer not null default 1,
  planned_kg  numeric not null default 0 check (planned_kg >= 0),
  status      text not null default 'Planned' check (status in ('Planned','Released','InProgress','Done','Void')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists t_work_order_bulk_so_idx       on public.t_work_order_bulk (so_id);
create index if not exists t_work_order_bulk_campaign_idx on public.t_work_order_bulk (campaign_no);
create index if not exists t_work_order_bulk_status_idx   on public.t_work_order_bulk (status);
drop trigger if exists t_work_order_bulk_touch on public.t_work_order_bulk;
create trigger t_work_order_bulk_touch before update on public.t_work_order_bulk
  for each row execute function public.touch_updated_at();

-- ---------- RLS: same v1 policy as the baseline (staff read/write) ----------
-- Phase 6 replaces this with per-role policies generated from rbac.js.
do $$
declare t text;
begin
  foreach t in array array['t_sales_order','t_purchase_req','t_calloff','t_work_order_bulk'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== SOURCE: 004_purchasing_warehouse_lots.sql ==========
-- ============================================================
--  004 - PURCHASING + WAREHOUSE INBOUND + LOT LEDGER
--  Phase 3 of the pipeline:
--    t_purchase_order  (FR-PP-14) - line-level purchase order raised
--                      from a purchase requisition; rows sharing a
--                      po_no form one PO. Status Open -> Partial ->
--                      Closed as lines are received.
--    t_inventory_lot   - a received material lot (No. Analisa CIKC...)
--                      with certificates and a QA release gate
--                      Quarantine -> Released -> Rejected.
--    t_inventory_txn   - append-only stock ledger (RECEIPT / ISSUE /
--                      TRANSFER / ADJUST). SOH is derived from it and
--                      cached on materials.stock_qty by store logic.
--    t_staging         - FR-PP-01 (raw) / FR-PP-04 (packaging) pick
--                      lists against Released lots (FIFO); a Reserved
--                      line allocates stock to a work order, dispensing
--                      posts the ISSUE and prints the FR-PP-10 tag.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key
--  cannot execute DDL). Idempotent - safe to re-run.
--  Depends on 003 (t_purchase_req, t_work_order_bulk) and the
--  baseline schema (materials, fg_master). Until it runs the app
--  keeps these rows queued locally (sync.js tolerates missing tables).
-- ============================================================

-- ---------- purchase order lines (FR-PP-14) ----------
-- One row per ordered material line; rows sharing a po_no form one PO.
create table if not exists public.t_purchase_order (
  id            text primary key,
  po_no         text not null default '',
  pr_id         text references public.t_purchase_req(id) on delete set null,
  supplier      text not null default '',
  material_code text not null default '',
  material_name text not null default '',
  qty           numeric not null default 0 check (qty >= 0),          -- ordered
  received_qty  numeric not null default 0 check (received_qty >= 0), -- accumulated
  unit_price    numeric not null default 0,
  unit          text not null default '',
  lead_days     integer not null default 0,
  eta           date,
  status        text not null default 'Open' check (status in ('Open','Partial','Closed','Cancelled')),
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_purchase_order_no_idx     on public.t_purchase_order (po_no);
create index if not exists t_purchase_order_pr_idx     on public.t_purchase_order (pr_id);
create index if not exists t_purchase_order_mat_idx    on public.t_purchase_order (material_code);
create index if not exists t_purchase_order_status_idx on public.t_purchase_order (status);
drop trigger if exists t_purchase_order_touch on public.t_purchase_order;
create trigger t_purchase_order_touch before update on public.t_purchase_order
  for each row execute function public.touch_updated_at();

-- ---------- inventory lot (QA release gate) ----------
create table if not exists public.t_inventory_lot (
  id            text primary key,
  lot_no        text not null default '',            -- No. Analisa (CIKC...)
  material_code text not null default '',
  material_name text not null default '',
  po_id         text references public.t_purchase_order(id) on delete set null,
  qty           numeric not null default 0 check (qty >= 0),           -- current on-hand in the lot
  qty_received  numeric not null default 0 check (qty_received >= 0),  -- original received qty
  uom           text not null default '',
  received_at   date,
  coa_ref       text not null default '',
  halal_ref     text not null default '',
  msds_ref      text not null default '',
  expiry        date,
  status        text not null default 'Quarantine' check (status in ('Quarantine','Released','Rejected')),
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_inventory_lot_mat_idx    on public.t_inventory_lot (material_code);
create index if not exists t_inventory_lot_no_idx     on public.t_inventory_lot (lot_no);
create index if not exists t_inventory_lot_po_idx     on public.t_inventory_lot (po_id);
create index if not exists t_inventory_lot_status_idx on public.t_inventory_lot (status);
drop trigger if exists t_inventory_lot_touch on public.t_inventory_lot;
create trigger t_inventory_lot_touch before update on public.t_inventory_lot
  for each row execute function public.touch_updated_at();

-- ---------- inventory ledger (append-only) ----------
-- Signed qty: RECEIPT/ADJUST-up positive, ISSUE negative. SOH for a
-- material = opening balance + sum(qty); the store caches it on
-- materials.stock_qty and refreshes it on every posting.
create table if not exists public.t_inventory_txn (
  id            text primary key,
  txn_type      text not null default 'RECEIPT' check (txn_type in ('RECEIPT','ISSUE','TRANSFER','ADJUST')),
  material_code text not null default '',
  material_name text not null default '',
  lot_id        text references public.t_inventory_lot(id)     on delete set null,
  wo_id         text references public.t_work_order_bulk(id)   on delete set null,
  qty           numeric not null default 0,             -- signed
  uom           text not null default '',
  ref_type      text not null default '',               -- PO | STAGING | ADJUST | OPENING
  ref_id        text not null default '',
  note          text not null default '',
  txn_at        text not null default '',               -- WIB timestamp string
  created_at    timestamptz not null default now()
);
create index if not exists t_inventory_txn_mat_idx  on public.t_inventory_txn (material_code);
create index if not exists t_inventory_txn_lot_idx  on public.t_inventory_txn (lot_id);
create index if not exists t_inventory_txn_type_idx on public.t_inventory_txn (txn_type);
create index if not exists t_inventory_txn_wo_idx   on public.t_inventory_txn (wo_id);
create index if not exists t_inventory_txn_created_idx on public.t_inventory_txn (created_at desc);

-- ---------- staging pick list lines (FR-PP-01 / FR-PP-04 / FR-PP-10) ----------
-- One row per picked lot line; rows sharing a staging_no form one pick
-- list. Reserved lines allocate stock to a work order; dispensing posts
-- the ISSUE ledger row and records the FR-PP-10 weighing tag.
create table if not exists public.t_staging (
  id            text primary key,
  staging_no    text not null default '',
  doc_type      text not null default 'FR-PP-01' check (doc_type in ('FR-PP-01','FR-PP-04')),
  wo_id         text references public.t_work_order_bulk(id) on delete set null,
  campaign_no   text not null default '',
  fg_id         text references public.fg_master(id)         on delete set null,
  material_code text not null default '',
  material_name text not null default '',
  lot_id        text references public.t_inventory_lot(id)   on delete set null,
  lot_no        text not null default '',
  qty           numeric not null default 0 check (qty >= 0),
  uom           text not null default '',
  status        text not null default 'Reserved' check (status in ('Reserved','Dispensed','Cancelled')),
  weighed_by    text not null default '',
  weighed_at    text not null default '',
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_staging_no_idx     on public.t_staging (staging_no);
create index if not exists t_staging_wo_idx     on public.t_staging (wo_id);
create index if not exists t_staging_lot_idx    on public.t_staging (lot_id);
create index if not exists t_staging_mat_idx    on public.t_staging (material_code);
create index if not exists t_staging_status_idx on public.t_staging (status);
drop trigger if exists t_staging_touch on public.t_staging;
create trigger t_staging_touch before update on public.t_staging
  for each row execute function public.touch_updated_at();

-- ---------- RLS: same v1 policy as the baseline (staff read/write) ----------
-- Phase 6 replaces this with per-role policies generated from rbac.js.
do $$
declare t text;
begin
  foreach t in array array['t_purchase_order','t_inventory_lot','t_inventory_txn','t_staging'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== SOURCE: 005_qa_production_execution.sql ==========
-- ============================================================
--  005 - QA/QC GATES + PRODUCTION EXECUTION
--  Phase 4 of the pipeline:
--    t_line_clearance  (FR-QA-21 mixing & filling, FR-QA-23 inkjet
--                      batch/ED, FR-QA-22 packing) - a QC-signed
--                      checklist that gates the next operation; the
--                      state machine blocks a work order from starting
--                      until the matching clearance is Passed.
--    t_ipc_record      (FR-QA-25 weight uniformity, FR-QC-05 seal
--                      integrity, plus scrapper/homogenizer Hz and
--                      temperature profiles) - checkpoints validated
--                      against the limits on the formula/packaging
--                      masters (ph_min/max, fill_min/max).
--    t_wo_bulk_phase   - BMR mixing execution rows (FR-QA-12) / daily
--                      sheet (FR-PR-23): theoretical vs actual weight
--                      per phase, child of t_work_order_bulk.
--    t_btip_transfer   (FR-PR-21/22) - bulk transfer vessel -> hopper.
--    t_work_order_pack (FR-QA-13) - filling & packing execution with
--                      theoretical output, rejects, actual yield,
--                      labor/machine hours and rendemen % (95-100%).
--    t_release         (FR-QC-06) - final disposition Approved /
--                      Rejected / Hold; only Approved may proceed to
--                      FG receipt (Phase 5). Archive retention split.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key
--  cannot execute DDL). Idempotent - safe to re-run.
--  Depends on 003 (t_work_order_bulk, t_sales_order) and the baseline
--  schema (fg_master). Until it runs the app keeps these rows queued
--  locally (sync.js tolerates the missing tables).
-- ============================================================

-- ---------- line clearance (FR-QA-21 / FR-QA-22 / FR-QA-23) ----------
-- wo_id is a plain text ref (it may point at a bulk OR a pack work
-- order), so it carries no FK; wo_type disambiguates.
create table if not exists public.t_line_clearance (
  id             text primary key,
  clearance_no   text not null default '',
  clearance_type text not null default 'FR-QA-21' check (clearance_type in ('FR-QA-21','FR-QA-22','FR-QA-23')),
  wo_type        text not null default 'Bulk' check (wo_type in ('Bulk','Pack')),
  wo_id          text not null default '',
  wo_ref         text not null default '',
  campaign_no    text not null default '',
  checklist      jsonb not null default '[]'::jsonb,   -- [{item, ok, note}]
  status         text not null default 'Open' check (status in ('Open','Passed','Failed')),
  qc_signer      text not null default '',
  qc_time        text not null default '',             -- WIB timestamp string
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists t_line_clearance_wo_idx     on public.t_line_clearance (wo_id);
create index if not exists t_line_clearance_type_idx   on public.t_line_clearance (clearance_type);
create index if not exists t_line_clearance_status_idx on public.t_line_clearance (status);
drop trigger if exists t_line_clearance_touch on public.t_line_clearance;
create trigger t_line_clearance_touch before update on public.t_line_clearance
  for each row execute function public.touch_updated_at();

-- ---------- IPC record (FR-QA-25 / FR-QC-05 / process profile) ----------
create table if not exists public.t_ipc_record (
  id          text primary key,
  ipc_no      text not null default '',
  ipc_type    text not null default 'FR-QA-25' check (ipc_type in ('FR-QA-25','FR-QC-05','PROCESS')),
  wo_id       text not null default '',
  wo_ref      text not null default '',
  campaign_no text not null default '',
  fg_id       text references public.fg_master(id) on delete set null,
  checks      jsonb not null default '[]'::jsonb,   -- [{param, value, unit, min, max, pass}]
  result      text not null default 'Pass' check (result in ('Pass','Fail')),
  inspector   text not null default '',
  recorded_at text not null default '',
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists t_ipc_record_wo_idx   on public.t_ipc_record (wo_id);
create index if not exists t_ipc_record_type_idx on public.t_ipc_record (ipc_type);
create index if not exists t_ipc_record_fg_idx   on public.t_ipc_record (fg_id);
drop trigger if exists t_ipc_record_touch on public.t_ipc_record;
create trigger t_ipc_record_touch before update on public.t_ipc_record
  for each row execute function public.touch_updated_at();

-- ---------- bulk work order phase rows (BMR mixing FR-QA-12 / FR-PR-23) ----------
create table if not exists public.t_wo_bulk_phase (
  id             text primary key,
  wo_id          text references public.t_work_order_bulk(id) on delete cascade,
  phase_no       integer not null default 1,
  phase_name     text not null default '',
  material_code  text not null default '',
  material_name  text not null default '',
  theoretical_kg numeric not null default 0,
  actual_kg      numeric not null default 0,
  vessel         text not null default '',
  homogenizer_hz numeric not null default 0,
  temperature_c  numeric not null default 0,
  started_at     text not null default '',
  ended_at       text not null default '',
  operator       text not null default '',
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists t_wo_bulk_phase_wo_idx on public.t_wo_bulk_phase (wo_id);
drop trigger if exists t_wo_bulk_phase_touch on public.t_wo_bulk_phase;
create trigger t_wo_bulk_phase_touch before update on public.t_wo_bulk_phase
  for each row execute function public.touch_updated_at();

-- ---------- BTIP bulk transfer (FR-PR-21 / FR-PR-22) ----------
create table if not exists public.t_btip_transfer (
  id            text primary key,
  transfer_no   text not null default '',
  wo_id         text references public.t_work_order_bulk(id) on delete set null,
  campaign_no   text not null default '',
  from_vessel   text not null default '',
  to_hopper     text not null default '',
  bulk_code     text not null default '',
  qty           numeric not null default 0 check (qty >= 0),
  uom           text not null default 'Kg',
  transferred_by text not null default '',
  qa_by         text not null default '',
  transferred_at text not null default '',
  status        text not null default 'Draft' check (status in ('Draft','Confirmed','Void')),
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_btip_transfer_wo_idx     on public.t_btip_transfer (wo_id);
create index if not exists t_btip_transfer_no_idx     on public.t_btip_transfer (transfer_no);
create index if not exists t_btip_transfer_status_idx on public.t_btip_transfer (status);
drop trigger if exists t_btip_transfer_touch on public.t_btip_transfer;
create trigger t_btip_transfer_touch before update on public.t_btip_transfer
  for each row execute function public.touch_updated_at();

-- ---------- pack work order execution (BMR filling & packing FR-QA-13) ----------
create table if not exists public.t_work_order_pack (
  id                text primary key,
  wo_no             text not null default '',
  campaign_no       text not null default '',
  so_id             text references public.t_sales_order(id)    on delete set null,
  fg_id             text references public.fg_master(id)        on delete set null,
  bulk_wo_id        text references public.t_work_order_bulk(id) on delete set null,
  bulk_code         text not null default '',
  status            text not null default 'Planned' check (status in ('Planned','Released','InProgress','Done','Void')),
  theoretical_output numeric not null default 0 check (theoretical_output >= 0),
  rejects           numeric not null default 0 check (rejects >= 0),
  actual_yield      numeric not null default 0 check (actual_yield >= 0),
  output_unit       text not null default 'pcs',
  labor_hours       numeric not null default 0 check (labor_hours >= 0),
  machine_hours     numeric not null default 0 check (machine_hours >= 0),
  rendemen_pct      numeric not null default 0,
  variance_remark   text not null default '',
  started_at        text not null default '',
  done_at           text not null default '',
  note              text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists t_work_order_pack_so_idx       on public.t_work_order_pack (so_id);
create index if not exists t_work_order_pack_fg_idx       on public.t_work_order_pack (fg_id);
create index if not exists t_work_order_pack_campaign_idx on public.t_work_order_pack (campaign_no);
create index if not exists t_work_order_pack_status_idx   on public.t_work_order_pack (status);
drop trigger if exists t_work_order_pack_touch on public.t_work_order_pack;
create trigger t_work_order_pack_touch before update on public.t_work_order_pack
  for each row execute function public.touch_updated_at();

-- ---------- release / disposition (FR-QC-06) ----------
create table if not exists public.t_release (
  id           text primary key,
  release_no   text not null default '',
  wo_pack_id   text references public.t_work_order_pack(id) on delete set null,
  fg_id        text references public.fg_master(id)         on delete set null,
  campaign_no  text not null default '',
  batch_lot    text not null default '',
  disposition  text not null default 'Pending' check (disposition in ('Pending','Approved','Rejected','Hold')),
  qa_copy      text not null default '',   -- archive retention: QA copy ref
  qc_copy      text not null default '',   -- archive retention: QC copy ref
  signer       text not null default '',
  released_at  text not null default '',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists t_release_pack_idx        on public.t_release (wo_pack_id);
create index if not exists t_release_fg_idx          on public.t_release (fg_id);
create index if not exists t_release_no_idx          on public.t_release (release_no);
create index if not exists t_release_disposition_idx on public.t_release (disposition);
drop trigger if exists t_release_touch on public.t_release;
create trigger t_release_touch before update on public.t_release
  for each row execute function public.touch_updated_at();

-- ---------- RLS: same v1 policy as the baseline (staff read/write) ----------
-- Phase 6 replaces this with per-role policies generated from rbac.js.
do $$
declare t text;
begin
  foreach t in array array['t_line_clearance','t_ipc_record','t_wo_bulk_phase','t_btip_transfer','t_work_order_pack','t_release'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== SOURCE: 006_fg_logistics.sql ==========
-- ============================================================
--  006 - FINISHED-GOODS WAREHOUSE & OUTBOUND LOGISTICS
--  Phase 5 of the pipeline:
--    t_fg_receipt    (FR-PR-02) - created from an APPROVED pack work
--                      order (t_release disposition Approved). It
--                      backflushes the component lots FIFO, becomes the
--                      finished-goods lot (qty_on_hand for FIFO picking)
--                      and posts a RECEIPT to the Kartu Stock Barang
--                      Jadi ledger.
--    t_delivery_order(Surat Jalan) - outbound against a CONFIRMED sales
--                      order; picks FG lots FIFO, and on close decrements
--                      the FG ledger and closes the SO when fully
--                      delivered. Status Open -> Closed / Void.
--    t_delivery_line - per-FG-lot pick lines of a Surat Jalan.
--    t_fg_txn        - append-only finished-goods ledger (Kartu Stock
--                      Barang Jadi): RECEIPT / ISSUE / ADJUST, signed qty.
--                      FG SOH is derived from it (no opening balance).
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key
--  cannot execute DDL). Idempotent - safe to re-run.
--  Depends on 003 (t_sales_order), 004 (t_inventory_lot / t_inventory_txn),
--  005 (t_work_order_pack, t_release) and the baseline (fg_master,
--  m_customer). Until it runs the app keeps these rows queued locally
--  (sync.js tolerates the missing tables).
-- ============================================================

-- ---------- finished-goods receipt / lot (FR-PR-02) ----------
-- One row per received FG batch; it also acts as the FG lot, so it
-- carries qty_on_hand which delivery orders draw down FIFO.
create table if not exists public.t_fg_receipt (
  id            text primary key,
  receipt_no    text not null default '',
  wo_pack_id    text references public.t_work_order_pack(id) on delete set null,
  release_id    text references public.t_release(id)         on delete set null,
  fg_id         text references public.fg_master(id)         on delete set null,
  kode_fg       text not null default '',
  batch_lot     text not null default '',
  campaign_no   text not null default '',
  qty           numeric not null default 0 check (qty >= 0),            -- received
  qty_on_hand   numeric not null default 0 check (qty_on_hand >= 0),    -- remaining
  uom           text not null default 'pcs',
  expiry        date,
  produced_at   text not null default '',             -- WIB, FIFO ordering key
  received_at   date,
  received_by   text not null default '',
  backflush     jsonb not null default '[]'::jsonb,   -- [{materialCode, required, dispensed, issued, short, uom, picks:[{lotNo,qty}]}]
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_fg_receipt_fg_idx     on public.t_fg_receipt (fg_id);
create index if not exists t_fg_receipt_kode_idx   on public.t_fg_receipt (kode_fg);
create index if not exists t_fg_receipt_pack_idx   on public.t_fg_receipt (wo_pack_id);
create index if not exists t_fg_receipt_batch_idx  on public.t_fg_receipt (batch_lot);
drop trigger if exists t_fg_receipt_touch on public.t_fg_receipt;
create trigger t_fg_receipt_touch before update on public.t_fg_receipt
  for each row execute function public.touch_updated_at();

-- ---------- delivery order / Surat Jalan (outbound) ----------
create table if not exists public.t_delivery_order (
  id            text primary key,
  sj_no         text not null default '',
  so_id         text references public.t_sales_order(id) on delete set null,
  customer_id   text references public.m_customer(id)    on delete set null,
  customer_name text not null default '',
  fg_id         text references public.fg_master(id)     on delete set null,
  kode_fg       text not null default '',
  vehicle       text not null default '',
  driver        text not null default '',
  status        text not null default 'Open' check (status in ('Open','Closed','Void')),
  delivered_at  text not null default '',
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_delivery_order_so_idx     on public.t_delivery_order (so_id);
create index if not exists t_delivery_order_sj_idx     on public.t_delivery_order (sj_no);
create index if not exists t_delivery_order_fg_idx     on public.t_delivery_order (fg_id);
create index if not exists t_delivery_order_status_idx on public.t_delivery_order (status);
drop trigger if exists t_delivery_order_touch on public.t_delivery_order;
create trigger t_delivery_order_touch before update on public.t_delivery_order
  for each row execute function public.touch_updated_at();

-- ---------- delivery order pick lines ----------
create table if not exists public.t_delivery_line (
  id            text primary key,
  do_id         text references public.t_delivery_order(id) on delete cascade,
  fg_receipt_id text references public.t_fg_receipt(id)     on delete set null,
  batch_lot     text not null default '',
  kode_fg       text not null default '',
  qty           numeric not null default 0 check (qty >= 0),
  uom           text not null default 'pcs',
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists t_delivery_line_do_idx  on public.t_delivery_line (do_id);
create index if not exists t_delivery_line_fgr_idx on public.t_delivery_line (fg_receipt_id);
drop trigger if exists t_delivery_line_touch on public.t_delivery_line;
create trigger t_delivery_line_touch before update on public.t_delivery_line
  for each row execute function public.touch_updated_at();

-- ---------- finished-goods ledger (Kartu Stock Barang Jadi) ----------
-- Signed qty: RECEIPT positive, ISSUE negative. FG SOH for a kode_fg =
-- sum(qty); there is no opening balance (FG is only ever produced here).
create table if not exists public.t_fg_txn (
  id            text primary key,
  txn_type      text not null default 'RECEIPT' check (txn_type in ('RECEIPT','ISSUE','ADJUST')),
  fg_id         text references public.fg_master(id)     on delete set null,
  kode_fg       text not null default '',
  fg_receipt_id text references public.t_fg_receipt(id)  on delete set null,
  do_id         text references public.t_delivery_order(id) on delete set null,
  qty           numeric not null default 0,             -- signed
  uom           text not null default 'pcs',
  ref_type      text not null default '',               -- FG_RECEIPT | SJ | ADJUST
  ref_id        text not null default '',
  note          text not null default '',
  txn_at        text not null default '',               -- WIB timestamp string
  created_at    timestamptz not null default now()
);
create index if not exists t_fg_txn_kode_idx    on public.t_fg_txn (kode_fg);
create index if not exists t_fg_txn_fgr_idx     on public.t_fg_txn (fg_receipt_id);
create index if not exists t_fg_txn_do_idx      on public.t_fg_txn (do_id);
create index if not exists t_fg_txn_type_idx    on public.t_fg_txn (txn_type);
create index if not exists t_fg_txn_created_idx on public.t_fg_txn (created_at desc);

-- ---------- RLS: same v1 policy as the baseline (staff read/write) ----------
-- Phase 6 replaces this with per-role policies generated from rbac.js.
do $$
declare t text;
begin
  foreach t in array array['t_fg_receipt','t_delivery_order','t_delivery_line','t_fg_txn'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists staff_all on public.%I', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ========== SOURCE: 007_master_supplier.sql ==========
-- ============================================================
--  007 - MASTER SUPPLIER
--  Adds the vendor master (m_supplier) that Master Material and the
--  Purchase Requisition / Purchase Order reference by id, replacing the
--  legacy free-text "supplier" field (whose placeholder conflated the
--  customer with the vendor). Mirrors m_customer (migration 002): one
--  row per vendor, maintained by Purchasing.
--
--  Existing free-text supplier names on materials / t_purchase_req /
--  t_purchase_order are backfilled into m_supplier and linked through a
--  new supplier_id FK (on delete set null). The free-text supplier name
--  column is KEPT as a print / display snapshot so historic documents
--  still render even if the vendor is later removed.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key cannot
--  execute DDL). Idempotent - safe to re-run.
--  Depends on the baseline schema (materials) + 003 (t_purchase_req) +
--  004 (t_purchase_order). Apply BEFORE 008 (RLS hardening), which
--  replaces the temporary staff_all policy below with per-role rules
--  generated from rbac.js.
-- ============================================================

-- ---------- supplier master ----------
create table if not exists public.m_supplier (
  id         text primary key,            -- supplier code, e.g. SUP-001
  name       text not null default '',
  address    text not null default '',
  pic        text not null default '',    -- person in charge
  contact    text not null default '',    -- phone / email
  terms      text not null default '',    -- payment / delivery terms
  updated_at timestamptz not null default now()
);
drop trigger if exists m_supplier_touch on public.m_supplier;
create trigger m_supplier_touch before update on public.m_supplier
  for each row execute function public.touch_updated_at();

-- ---------- supplier_id FK on the tables that name a vendor ----------
alter table public.materials        add column if not exists supplier_id text references public.m_supplier(id) on delete set null;
alter table public.t_purchase_req   add column if not exists supplier_id text references public.m_supplier(id) on delete set null;
alter table public.t_purchase_order add column if not exists supplier_id text references public.m_supplier(id) on delete set null;
create index if not exists materials_supplier_idx        on public.materials (supplier_id);
create index if not exists t_purchase_req_supplier_idx   on public.t_purchase_req (supplier_id);
create index if not exists t_purchase_order_supplier_idx on public.t_purchase_order (supplier_id);

-- ---------- backfill m_supplier from the distinct free-text names ----------
-- One vendor per distinct (case-insensitive) supplier string across the three
-- tables; ids are generated SUP-0001.. in name order, offset by the current
-- row count so a re-run never collides. Names already present are skipped.
with src as (
  select trim(supplier) as nm from public.materials        where coalesce(trim(supplier), '') <> ''
  union
  select trim(supplier) as nm from public.t_purchase_req   where coalesce(trim(supplier), '') <> ''
  union
  select trim(supplier) as nm from public.t_purchase_order where coalesce(trim(supplier), '') <> ''
),
uniq as (
  select lower(nm) as k, min(nm) as nm from src group by lower(nm)
),
fresh as (
  select u.k, u.nm from uniq u
  where not exists (select 1 from public.m_supplier s where lower(s.name) = u.k)
),
numbered as (
  select f.nm,
         'SUP-' || lpad(((select count(*) from public.m_supplier)
                         + row_number() over (order by f.nm))::text, 4, '0') as id
  from fresh f
)
insert into public.m_supplier (id, name)
select id, nm from numbered
on conflict (id) do nothing;

-- ---------- link the free-text rows to their supplier ----------
update public.materials m set supplier_id = s.id
  from public.m_supplier s
  where m.supplier_id is null and coalesce(trim(m.supplier), '') <> ''
    and lower(s.name) = lower(trim(m.supplier));
update public.t_purchase_req p set supplier_id = s.id
  from public.m_supplier s
  where p.supplier_id is null and coalesce(trim(p.supplier), '') <> ''
    and lower(s.name) = lower(trim(p.supplier));
update public.t_purchase_order p set supplier_id = s.id
  from public.m_supplier s
  where p.supplier_id is null and coalesce(trim(p.supplier), '') <> ''
    and lower(s.name) = lower(trim(p.supplier));

-- ---------- RLS: temporary staff_all until 008 hardens it per role ----------
alter table public.m_supplier enable row level security;
drop policy if exists staff_all on public.m_supplier;
create policy staff_all on public.m_supplier for all to authenticated using (true) with check (true);

-- ========== SOURCE: 008_rls_policies.sql ==========
-- ============================================================
--  008 - SERVER-SIDE RBAC (ROW LEVEL SECURITY) POLICIES
--  GENERATED FILE - DO NOT EDIT BY HAND.
--  Source of truth: assets/js/rbac.js   Regenerate: node tools/gen-rls.js
--
--  Replaces the blanket staff_all policy (schema.sql + migrations 002-007)
--  with per-role WRITE policies derived from rbac.js, plus a column-ownership
--  guard on fg_master. SELECT stays open to every signed-in staff account
--  (in the app every role can view every page); Admin bypasses every gate.
--  The UI role matrix remains the first line of defence - this is the second.
--
--  Apply AFTER 002-007 in the Supabase SQL Editor. Because a first full sync
--  deletes + re-pushes every table, SIGN IN AS ADMIN once after applying so the
--  seed upload is not blocked by the new write policies.
-- ============================================================

-- ---------- role helper (security definer avoids profiles-RLS recursion) ----------
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- drop the blanket staff_all policy on every business table ----------
do $$
declare t text;
begin
  foreach t in array array['fg_master', 'm_customer', 'm_supplier', 'm_formula', 'm_packaging', 'm_mixer', 'materials', 'boms', 'bom_lines', 'sims', 'requests', 'meta_kv', 't_sales_order', 't_purchase_req', 't_calloff', 't_work_order_bulk', 't_purchase_order', 't_inventory_lot', 't_inventory_txn', 't_staging', 't_line_clearance', 't_ipc_record', 't_wo_bulk_phase', 't_btip_transfer', 't_work_order_pack', 't_release', 't_fg_receipt', 't_delivery_order', 't_delivery_line', 't_fg_txn'] loop
    execute format('drop policy if exists staff_all on public.%I', t);
  end loop;
end $$;

-- ---------- ensure RLS is enabled everywhere (idempotent) ----------
do $$
declare t text;
begin
  foreach t in array array['fg_master', 'm_customer', 'm_supplier', 'm_formula', 'm_packaging', 'm_mixer', 'materials', 'boms', 'bom_lines', 'sims', 'requests', 'meta_kv', 't_sales_order', 't_purchase_req', 't_calloff', 't_work_order_bulk', 't_purchase_order', 't_inventory_lot', 't_inventory_txn', 't_staging', 't_line_clearance', 't_ipc_record', 't_wo_bulk_phase', 't_btip_transfer', 't_work_order_pack', 't_release', 't_fg_receipt', 't_delivery_order', 't_delivery_line', 't_fg_txn', 'audit_log', 'profiles'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================
--  Master data (owned per rbac.js MASTER_EDITORS / FG_EDITOR_ROLES)
-- ============================================================

-- fg_master  (write: Admin, RND Formula, RND Kemas, Regulatory)
drop policy if exists fg_master_read on public.fg_master;
create policy fg_master_read on public.fg_master for select to authenticated using (true);
drop policy if exists fg_master_insert on public.fg_master;
create policy fg_master_insert on public.fg_master for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));
drop policy if exists fg_master_update on public.fg_master;
create policy fg_master_update on public.fg_master for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));
drop policy if exists fg_master_delete on public.fg_master;
create policy fg_master_delete on public.fg_master for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));

-- m_customer  (write: Admin, Marketing)
drop policy if exists m_customer_read on public.m_customer;
create policy m_customer_read on public.m_customer for select to authenticated using (true);
drop policy if exists m_customer_insert on public.m_customer;
create policy m_customer_insert on public.m_customer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_customer_update on public.m_customer;
create policy m_customer_update on public.m_customer for update to authenticated using (public.auth_role() = any (array['Admin', 'Marketing'])) with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_customer_delete on public.m_customer;
create policy m_customer_delete on public.m_customer for delete to authenticated using (public.auth_role() = any (array['Admin', 'Marketing']));

-- m_supplier  (write: Admin, Purchasing)
drop policy if exists m_supplier_read on public.m_supplier;
create policy m_supplier_read on public.m_supplier for select to authenticated using (true);
drop policy if exists m_supplier_insert on public.m_supplier;
create policy m_supplier_insert on public.m_supplier for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Purchasing']));
drop policy if exists m_supplier_update on public.m_supplier;
create policy m_supplier_update on public.m_supplier for update to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing'])) with check (public.auth_role() = any (array['Admin', 'Purchasing']));
drop policy if exists m_supplier_delete on public.m_supplier;
create policy m_supplier_delete on public.m_supplier for delete to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing']));

-- m_formula  (write: Admin, RND Formula)
drop policy if exists m_formula_read on public.m_formula;
create policy m_formula_read on public.m_formula for select to authenticated using (true);
drop policy if exists m_formula_insert on public.m_formula;
create policy m_formula_insert on public.m_formula for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula']));
drop policy if exists m_formula_update on public.m_formula;
create policy m_formula_update on public.m_formula for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula'])) with check (public.auth_role() = any (array['Admin', 'RND Formula']));
drop policy if exists m_formula_delete on public.m_formula;
create policy m_formula_delete on public.m_formula for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula']));

-- m_packaging  (write: Admin, RND Kemas)
drop policy if exists m_packaging_read on public.m_packaging;
create policy m_packaging_read on public.m_packaging for select to authenticated using (true);
drop policy if exists m_packaging_insert on public.m_packaging;
create policy m_packaging_insert on public.m_packaging for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Kemas']));
drop policy if exists m_packaging_update on public.m_packaging;
create policy m_packaging_update on public.m_packaging for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Kemas'])) with check (public.auth_role() = any (array['Admin', 'RND Kemas']));
drop policy if exists m_packaging_delete on public.m_packaging;
create policy m_packaging_delete on public.m_packaging for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Kemas']));

-- m_mixer  (write: Admin, PPIC, Production)
drop policy if exists m_mixer_read on public.m_mixer;
create policy m_mixer_read on public.m_mixer for select to authenticated using (true);
drop policy if exists m_mixer_insert on public.m_mixer;
create policy m_mixer_insert on public.m_mixer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));
drop policy if exists m_mixer_update on public.m_mixer;
create policy m_mixer_update on public.m_mixer for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));
drop policy if exists m_mixer_delete on public.m_mixer;
create policy m_mixer_delete on public.m_mixer for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));

-- ============================================================
--  Open masters - the UI does not role-gate these, so every staff account may write
-- ============================================================

-- materials  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated using (true);
drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists materials_delete on public.materials;
create policy materials_delete on public.materials for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- boms  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists boms_read on public.boms;
create policy boms_read on public.boms for select to authenticated using (true);
drop policy if exists boms_insert on public.boms;
create policy boms_insert on public.boms for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists boms_update on public.boms;
create policy boms_update on public.boms for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists boms_delete on public.boms;
create policy boms_delete on public.boms for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- bom_lines  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists bom_lines_read on public.bom_lines;
create policy bom_lines_read on public.bom_lines for select to authenticated using (true);
drop policy if exists bom_lines_insert on public.bom_lines;
create policy bom_lines_insert on public.bom_lines for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists bom_lines_update on public.bom_lines;
create policy bom_lines_update on public.bom_lines for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists bom_lines_delete on public.bom_lines;
create policy bom_lines_delete on public.bom_lines for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- sims  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists sims_read on public.sims;
create policy sims_read on public.sims for select to authenticated using (true);
drop policy if exists sims_insert on public.sims;
create policy sims_insert on public.sims for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists sims_update on public.sims;
create policy sims_update on public.sims for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists sims_delete on public.sims;
create policy sims_delete on public.sims for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- requests  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated using (true);
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- meta_kv  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists meta_kv_read on public.meta_kv;
create policy meta_kv_read on public.meta_kv for select to authenticated using (true);
drop policy if exists meta_kv_insert on public.meta_kv;
create policy meta_kv_insert on public.meta_kv for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists meta_kv_update on public.meta_kv;
create policy meta_kv_update on public.meta_kv for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists meta_kv_delete on public.meta_kv;
create policy meta_kv_delete on public.meta_kv for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- ============================================================
--  Sales order + PPIC planning
-- ============================================================

-- t_sales_order  (write: Admin, Marketing, PPIC, Warehouse)
drop policy if exists t_sales_order_read on public.t_sales_order;
create policy t_sales_order_read on public.t_sales_order for select to authenticated using (true);
drop policy if exists t_sales_order_insert on public.t_sales_order;
create policy t_sales_order_insert on public.t_sales_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));
drop policy if exists t_sales_order_update on public.t_sales_order;
create policy t_sales_order_update on public.t_sales_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));
drop policy if exists t_sales_order_delete on public.t_sales_order;
create policy t_sales_order_delete on public.t_sales_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));

-- t_purchase_req  (write: Admin, PPIC, Purchasing)
drop policy if exists t_purchase_req_read on public.t_purchase_req;
create policy t_purchase_req_read on public.t_purchase_req for select to authenticated using (true);
drop policy if exists t_purchase_req_insert on public.t_purchase_req;
create policy t_purchase_req_insert on public.t_purchase_req for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));
drop policy if exists t_purchase_req_update on public.t_purchase_req;
create policy t_purchase_req_update on public.t_purchase_req for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));
drop policy if exists t_purchase_req_delete on public.t_purchase_req;
create policy t_purchase_req_delete on public.t_purchase_req for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));

-- t_calloff  (write: Admin, PPIC)
drop policy if exists t_calloff_read on public.t_calloff;
create policy t_calloff_read on public.t_calloff for select to authenticated using (true);
drop policy if exists t_calloff_insert on public.t_calloff;
create policy t_calloff_insert on public.t_calloff for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC']));
drop policy if exists t_calloff_update on public.t_calloff;
create policy t_calloff_update on public.t_calloff for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC'])) with check (public.auth_role() = any (array['Admin', 'PPIC']));
drop policy if exists t_calloff_delete on public.t_calloff;
create policy t_calloff_delete on public.t_calloff for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC']));

-- t_work_order_bulk  (write: Admin, PPIC, Production, QA)
drop policy if exists t_work_order_bulk_read on public.t_work_order_bulk;
create policy t_work_order_bulk_read on public.t_work_order_bulk for select to authenticated using (true);
drop policy if exists t_work_order_bulk_insert on public.t_work_order_bulk;
create policy t_work_order_bulk_insert on public.t_work_order_bulk for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_bulk_update on public.t_work_order_bulk;
create policy t_work_order_bulk_update on public.t_work_order_bulk for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_bulk_delete on public.t_work_order_bulk;
create policy t_work_order_bulk_delete on public.t_work_order_bulk for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));

-- ============================================================
--  Purchasing + warehouse inbound + lot ledger
-- ============================================================

-- t_purchase_order  (write: Admin, Purchasing, Warehouse)
drop policy if exists t_purchase_order_read on public.t_purchase_order;
create policy t_purchase_order_read on public.t_purchase_order for select to authenticated using (true);
drop policy if exists t_purchase_order_insert on public.t_purchase_order;
create policy t_purchase_order_insert on public.t_purchase_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));
drop policy if exists t_purchase_order_update on public.t_purchase_order;
create policy t_purchase_order_update on public.t_purchase_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));
drop policy if exists t_purchase_order_delete on public.t_purchase_order;
create policy t_purchase_order_delete on public.t_purchase_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));

-- t_inventory_lot  (write: Admin, Warehouse, Purchasing, QA, Production)
drop policy if exists t_inventory_lot_read on public.t_inventory_lot;
create policy t_inventory_lot_read on public.t_inventory_lot for select to authenticated using (true);
drop policy if exists t_inventory_lot_insert on public.t_inventory_lot;
create policy t_inventory_lot_insert on public.t_inventory_lot for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));
drop policy if exists t_inventory_lot_update on public.t_inventory_lot;
create policy t_inventory_lot_update on public.t_inventory_lot for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));
drop policy if exists t_inventory_lot_delete on public.t_inventory_lot;
create policy t_inventory_lot_delete on public.t_inventory_lot for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));

-- t_inventory_txn  (write: Admin, Warehouse, Purchasing, Production, QA; delete: Admin only - append-only ledger)
drop policy if exists t_inventory_txn_read on public.t_inventory_txn;
create policy t_inventory_txn_read on public.t_inventory_txn for select to authenticated using (true);
drop policy if exists t_inventory_txn_insert on public.t_inventory_txn;
create policy t_inventory_txn_insert on public.t_inventory_txn for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA']));
drop policy if exists t_inventory_txn_update on public.t_inventory_txn;
create policy t_inventory_txn_update on public.t_inventory_txn for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA']));
drop policy if exists t_inventory_txn_delete on public.t_inventory_txn;
create policy t_inventory_txn_delete on public.t_inventory_txn for delete to authenticated using (public.auth_role() = any (array['Admin']));

-- t_staging  (write: Admin, Warehouse, Production)
drop policy if exists t_staging_read on public.t_staging;
create policy t_staging_read on public.t_staging for select to authenticated using (true);
drop policy if exists t_staging_insert on public.t_staging;
create policy t_staging_insert on public.t_staging for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_staging_update on public.t_staging;
create policy t_staging_update on public.t_staging for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_staging_delete on public.t_staging;
create policy t_staging_delete on public.t_staging for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));

-- ============================================================
--  QA/QC gates + production execution
-- ============================================================

-- t_line_clearance  (write: Admin, QA)
drop policy if exists t_line_clearance_read on public.t_line_clearance;
create policy t_line_clearance_read on public.t_line_clearance for select to authenticated using (true);
drop policy if exists t_line_clearance_insert on public.t_line_clearance;
create policy t_line_clearance_insert on public.t_line_clearance for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_line_clearance_update on public.t_line_clearance;
create policy t_line_clearance_update on public.t_line_clearance for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_line_clearance_delete on public.t_line_clearance;
create policy t_line_clearance_delete on public.t_line_clearance for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- t_ipc_record  (write: Admin, QA)
drop policy if exists t_ipc_record_read on public.t_ipc_record;
create policy t_ipc_record_read on public.t_ipc_record for select to authenticated using (true);
drop policy if exists t_ipc_record_insert on public.t_ipc_record;
create policy t_ipc_record_insert on public.t_ipc_record for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_ipc_record_update on public.t_ipc_record;
create policy t_ipc_record_update on public.t_ipc_record for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_ipc_record_delete on public.t_ipc_record;
create policy t_ipc_record_delete on public.t_ipc_record for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- t_wo_bulk_phase  (write: Admin, Production, QA)
drop policy if exists t_wo_bulk_phase_read on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_read on public.t_wo_bulk_phase for select to authenticated using (true);
drop policy if exists t_wo_bulk_phase_insert on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_insert on public.t_wo_bulk_phase for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Production', 'QA']));
drop policy if exists t_wo_bulk_phase_update on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_update on public.t_wo_bulk_phase for update to authenticated using (public.auth_role() = any (array['Admin', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'Production', 'QA']));
drop policy if exists t_wo_bulk_phase_delete on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_delete on public.t_wo_bulk_phase for delete to authenticated using (public.auth_role() = any (array['Admin', 'Production', 'QA']));

-- t_btip_transfer  (write: Admin, Production)
drop policy if exists t_btip_transfer_read on public.t_btip_transfer;
create policy t_btip_transfer_read on public.t_btip_transfer for select to authenticated using (true);
drop policy if exists t_btip_transfer_insert on public.t_btip_transfer;
create policy t_btip_transfer_insert on public.t_btip_transfer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Production']));
drop policy if exists t_btip_transfer_update on public.t_btip_transfer;
create policy t_btip_transfer_update on public.t_btip_transfer for update to authenticated using (public.auth_role() = any (array['Admin', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Production']));
drop policy if exists t_btip_transfer_delete on public.t_btip_transfer;
create policy t_btip_transfer_delete on public.t_btip_transfer for delete to authenticated using (public.auth_role() = any (array['Admin', 'Production']));

-- t_work_order_pack  (write: Admin, PPIC, Production, QA)
drop policy if exists t_work_order_pack_read on public.t_work_order_pack;
create policy t_work_order_pack_read on public.t_work_order_pack for select to authenticated using (true);
drop policy if exists t_work_order_pack_insert on public.t_work_order_pack;
create policy t_work_order_pack_insert on public.t_work_order_pack for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_pack_update on public.t_work_order_pack;
create policy t_work_order_pack_update on public.t_work_order_pack for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_pack_delete on public.t_work_order_pack;
create policy t_work_order_pack_delete on public.t_work_order_pack for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));

-- t_release  (write: Admin, QA)
drop policy if exists t_release_read on public.t_release;
create policy t_release_read on public.t_release for select to authenticated using (true);
drop policy if exists t_release_insert on public.t_release;
create policy t_release_insert on public.t_release for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_release_update on public.t_release;
create policy t_release_update on public.t_release for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_release_delete on public.t_release;
create policy t_release_delete on public.t_release for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- ============================================================
--  FG warehouse + outbound logistics
-- ============================================================

-- t_fg_receipt  (write: Admin, Warehouse, Production)
drop policy if exists t_fg_receipt_read on public.t_fg_receipt;
create policy t_fg_receipt_read on public.t_fg_receipt for select to authenticated using (true);
drop policy if exists t_fg_receipt_insert on public.t_fg_receipt;
create policy t_fg_receipt_insert on public.t_fg_receipt for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_receipt_update on public.t_fg_receipt;
create policy t_fg_receipt_update on public.t_fg_receipt for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_receipt_delete on public.t_fg_receipt;
create policy t_fg_receipt_delete on public.t_fg_receipt for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));

-- t_delivery_order  (write: Admin, Warehouse)
drop policy if exists t_delivery_order_read on public.t_delivery_order;
create policy t_delivery_order_read on public.t_delivery_order for select to authenticated using (true);
drop policy if exists t_delivery_order_insert on public.t_delivery_order;
create policy t_delivery_order_insert on public.t_delivery_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_order_update on public.t_delivery_order;
create policy t_delivery_order_update on public.t_delivery_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_order_delete on public.t_delivery_order;
create policy t_delivery_order_delete on public.t_delivery_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse']));

-- t_delivery_line  (write: Admin, Warehouse)
drop policy if exists t_delivery_line_read on public.t_delivery_line;
create policy t_delivery_line_read on public.t_delivery_line for select to authenticated using (true);
drop policy if exists t_delivery_line_insert on public.t_delivery_line;
create policy t_delivery_line_insert on public.t_delivery_line for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_line_update on public.t_delivery_line;
create policy t_delivery_line_update on public.t_delivery_line for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_line_delete on public.t_delivery_line;
create policy t_delivery_line_delete on public.t_delivery_line for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse']));

-- t_fg_txn  (write: Admin, Warehouse, Production; delete: Admin only - append-only ledger)
drop policy if exists t_fg_txn_read on public.t_fg_txn;
create policy t_fg_txn_read on public.t_fg_txn for select to authenticated using (true);
drop policy if exists t_fg_txn_insert on public.t_fg_txn;
create policy t_fg_txn_insert on public.t_fg_txn for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_txn_update on public.t_fg_txn;
create policy t_fg_txn_update on public.t_fg_txn for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_txn_delete on public.t_fg_txn;
create policy t_fg_txn_delete on public.t_fg_txn for delete to authenticated using (public.auth_role() = any (array['Admin']));

-- ============================================================
--  Audit trail - readable by all staff, append-only (no update/delete policy)
-- ============================================================
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (true);
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated with check (true);
drop policy if exists audit_update on public.audit_log;
drop policy if exists audit_delete on public.audit_log;

-- ============================================================
--  Profiles - each user reads all, writes only their own row; Admin may
--  manage any row (Settings > role management is Admin-only in the UI).
-- ============================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.auth_role() = 'Admin')
  with check (id = auth.uid() or public.auth_role() = 'Admin');

-- ============================================================
--  fg_master column-ownership guard (from rbac.js FG_FIELD_RIGHTS).
--  RLS is row-scoped, so per-column ownership is enforced here: a role may
--  update the row but only the columns it owns. Derived/system columns
--  (kode_fg, status, diubah_oleh, waktu_update, updated_at) are unguarded.
-- ============================================================
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
  return new;
end $$;
drop trigger if exists fg_master_column_guard on public.fg_master;
create trigger fg_master_column_guard before update on public.fg_master
  for each row execute function public.fg_master_column_guard();

-- ========== SOURCE: 009_supplier_category.sql ==========
-- ============================================================
--  009 - SUPPLIER CATEGORY
--  Adds a category column to the vendor master (m_supplier) so each
--  supplier is labelled with what it supplies. The value is free text
--  (no DB enum) whose vocabulary is defined by the app (views-master
--  SUP_CAT_LABEL):
--    RM-INT  = Raw Material Internal
--    RM-EXT  = Raw Material External
--    PKG-INT = Packaging Internal
--    PKG-EXT = Packaging External
--    PREMIX  = Premix (raw materials blended into a new production material)
--    AUX-QA  = Auxiliary for QA/QC
--  Empty string = not set (legacy / multi-category vendors).
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key cannot
--  execute DDL). Idempotent - safe to re-run.
--  Depends on 007 (m_supplier). The app tolerates the column being
--  absent: sync.js drops it from supplier upserts until the cloud
--  schema cache exposes it again.
-- ============================================================

alter table public.m_supplier add column if not exists category text not null default '';
create index if not exists m_supplier_category_idx on public.m_supplier (category);

-- ========== SOURCE: 010_material_supplier_links.sql ==========
-- ============================================================
-- 010: Multi-supplier links on materials
-- Adds a JSONB array column storing per-supplier terms (MOQ,
-- lead time) so one material can be sourced from multiple vendors.
-- Existing single-supplier rows are migrated into the array.
-- ============================================================

alter table public.materials
  add column if not exists supplier_links jsonb not null default '[]';

-- Populate from the legacy single-supplier columns
update public.materials
   set supplier_links = jsonb_build_array(
     jsonb_build_object('supplierId', supplier_id, 'moq', moq, 'leadDays', lead_days)
   )
 where supplier_links = '[]'::jsonb
   and supplier_id is not null
   and supplier_id <> '';

-- ========== SOURCE: 011_formula_packaging_composition.sql ==========
-- 011: move composition ownership from BOM to Master Formula / Packaging
-- FFS (m_formula) gains a `lines` array: [{materialCode, pct, note}]
-- FPS (m_packaging) gains a `lines` array: [{materialCode, qty, supportedBy, note}]
-- The BOM builder will inherit composition from linked masters.

alter table public.m_formula add column if not exists lines jsonb not null default '[]';
alter table public.m_packaging add column if not exists lines jsonb not null default '[]';

-- ========== SOURCE: 012_packaging_volume.sql ==========
-- 012: simplify Master Packaging (FPS) data entry
--
-- The fill min / fill max pair becomes one nominal volume plus a symmetric
-- tolerance percentage, and the revision + shrink-tunnel parameters are
-- retired from the form (the FPS code itself is still typed by hand).
--
--   volume_ml     declared nominal fill volume   (backfilled from fill_min)
--   fill_tol_pct  acceptance band around it, consumed by the QA IPC
--                 weight-uniformity check (Store.ipcLimit -> fill / weight)
--
-- Existing declared ranges are preserved: the band is widened so it still
-- reaches the old fill_max, i.e. a 100-120 mL record becomes 100 mL +/- 20%.
-- Rows that had no range keep a 0% tolerance and act as an exact target.
--
-- Re-runnable: the backfill only runs while the old columns still exist.
-- Apply in the Supabase SQL Editor, then hard-reload the app so the new
-- assets (?v=24) replace the cached ones.

alter table public.m_packaging add column if not exists volume_ml    numeric not null default 0 check (volume_ml >= 0);
alter table public.m_packaging add column if not exists fill_tol_pct numeric not null default 0 check (fill_tol_pct >= 0);

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'm_packaging'
                and column_name = 'fill_min') then
    update public.m_packaging
       set volume_ml    = coalesce(nullif(fill_min, 0), 0),
           fill_tol_pct = case when fill_min > 0 and fill_max > fill_min
                               then round((fill_max - fill_min) / fill_min * 100, 2)
                               else 0 end;
  end if;
end $$;

/* dropping a column also drops the constraints that reference it,
   which retires the old check (fill_max >= fill_min) */
alter table public.m_packaging drop column if exists revisi;
alter table public.m_packaging drop column if exists fill_min;
alter table public.m_packaging drop column if exists fill_max;
alter table public.m_packaging drop column if exists shrink_tunnel_c;

-- ========== SOURCE: 013_role_guard.sql ==========
/* GENERATED by tools/gen-rls.js from assets/js/rbac.js - do not edit here. */
--  Source of truth: assets/js/rbac.js   Regenerate: node tools/gen-rls.js

-- ============================================================
--  013 - PROFILES.ROLE GUARD.
--  RLS is row-scoped, so 008's profiles_update / profiles_insert policies
--  (id = auth.uid() or auth_role() = 'Admin') restrict which ROW a caller
--  touches but not which COLUMN: any signed-in staff member could PATCH their
--  own role to 'Admin' with nothing but the anon key and their own JWT, and
--  the whole UI gate reads its answer from that column. This trigger is the
--  column-level half of that policy. Role vocabulary comes from RBAC.ROLES.
--
--  Apply after 008. Safe to re-run: create or replace + drop trigger first.
-- ============================================================

create or replace function public.profiles_role_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  valid text[] := array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'];
begin
  -- A typo'd role grants nothing and stays invisible until it bites, so
  -- reject unknown values on every path including the Dashboard.
  if not (new.role = any (valid)) then
    raise exception 'profiles.role % is not a known role', new.role;
  end if;

  -- No user session: SQL Editor, Table Editor, service_role, or the
  -- handle_new_user trigger. This is the maintenance path and the only way
  -- to create the first Admin, so it is trusted with the role column.
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    -- 008 confines an insert to the caller's own id. A non-Admin - including
    -- anyone whose profile row does not exist yet, where auth_role() is null -
    -- never picks their own role: fall back to the table default. Force rather
    -- than raise, because Sync.ensureProfile() legitimately creates its own row
    -- this way, and an upsert-merge reaches the server as an INSERT.
    if public.auth_role() = 'Admin' then return new; end if;
    new.role := 'PPIC';
    return new;
  end if;

  if new.role is distinct from old.role and public.auth_role() is distinct from 'Admin' then
    raise exception 'profiles.role is managed by Admin only (current role: %)', public.auth_role();
  end if;
  return new;
end $$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before insert or update on public.profiles
  for each row execute function public.profiles_role_guard();

-- ========== PART 3/3: migrations/014_staff_emp_id.sql ==========
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
