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
