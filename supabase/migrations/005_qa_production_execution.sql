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
