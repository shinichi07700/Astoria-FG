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
