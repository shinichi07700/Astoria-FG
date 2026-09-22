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
