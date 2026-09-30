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
