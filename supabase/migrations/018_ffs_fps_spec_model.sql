-- ============================================================
--  018 - FFS / FPS SPEC-SHEET MODEL (additive columns only)
--  Aligns the masters with the real FR-RD-09 (FFS) and FR-PD-03 /
--  PD00100 (FPS) sheets:
--    * FFS tab 1  -> m_formula.pdr_no (Marketing PDR reference)
--    * FFS tab 5  -> m_formula.special_handling (per-material weighing notes)
--    * FFS tab 7  -> m_formula_lab becomes the PRODUCT SPECIFICATION:
--                    specs jsonb (parameter / standard / method rows) plus
--                    expiry / spr_ref / storage_temp. Legacy result columns
--                    from 017 are kept as a derived cache for BOM/QA.
--    * FFS tab 2  -> m_formula_stab becomes TEST RESULT: panel / micro /
--                    compat / stability references alongside the obs cycles.
--    * FFS tab 4+6-> m_formula_machine.equipment jsonb; the nested
--                    Tahap->step->params work instruction lives in the
--                    existing phases jsonb (no schema change needed).
--    * FPS        -> m_packaging product_name, variants (names only, NO NA -
--                    Regulatory supplies NA on the F/G later), container,
--                    machines, steps, storage_temp, mbox_qty, absolute fill range.
--
--  Pure ALTER TABLE ... ADD COLUMN IF NOT EXISTS: idempotent, no new
--  tables, so existing RLS policies from 008/017 already cover the columns.
--  Run ONCE in: Supabase Dashboard > SQL Editor (anon key cannot DDL).
--  sync.js tolerates the columns being absent (has018 drift retry), so the
--  app keeps working before this migration is applied.
-- ============================================================

alter table public.m_formula        add column if not exists pdr_no           text    not null default '';
alter table public.m_formula        add column if not exists special_handling jsonb   not null default '[]';

alter table public.m_formula_lab    add column if not exists specs            jsonb   not null default '[]';
alter table public.m_formula_lab    add column if not exists expiry           text    not null default '';
alter table public.m_formula_lab    add column if not exists spr_ref          text    not null default '';
alter table public.m_formula_lab    add column if not exists storage_temp     text    not null default '';

alter table public.m_formula_stab   add column if not exists panel_ref        text    not null default '';
alter table public.m_formula_stab   add column if not exists micro_ref        text    not null default '';
alter table public.m_formula_stab   add column if not exists compat_ref       text    not null default '';
alter table public.m_formula_stab   add column if not exists stab_ref         text    not null default '';

alter table public.m_formula_machine add column if not exists equipment       jsonb   not null default '[]';

alter table public.m_packaging      add column if not exists product_name     text    not null default '';
alter table public.m_packaging      add column if not exists variants         jsonb   not null default '[]';
alter table public.m_packaging      add column if not exists container        jsonb   not null default '[]';
alter table public.m_packaging      add column if not exists machines         jsonb   not null default '[]';
alter table public.m_packaging      add column if not exists steps            jsonb   not null default '[]';
alter table public.m_packaging      add column if not exists storage_temp     text    not null default '';
alter table public.m_packaging      add column if not exists mbox_qty         integer not null default 0;
alter table public.m_packaging      add column if not exists fill_min_ml      numeric;
alter table public.m_packaging      add column if not exists fill_max_ml      numeric;