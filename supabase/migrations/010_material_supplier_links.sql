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
