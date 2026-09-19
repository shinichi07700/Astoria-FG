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
