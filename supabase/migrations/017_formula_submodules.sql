-- ============================================================
--  017 - MASTER FORMULA SUBMODULES (FFS lab / stability / machine)
--  FFS is composed of four parts: material composition (m_formula),
--  lab test parameter results, stability test records and machine
--  setup parameters. The last three get one table each, keyed by the
--  FFS code. Records are Draft until the approval chain lands; the
--  machine setup rows will feed BMR phase instructions later.
--
--  id is the FFS code with NO foreign key to m_formula on purpose:
--  lab / stability sheets can arrive (and be imported as Draft)
--  before the composition exists. The app warns on unmatched FFS
--  and the editors refuse to save without a master formula.
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key cannot
--  execute DDL). Idempotent - safe to re-run. The app tolerates the
--  tables being absent: sync.js skips them until this migration runs.
--  Write roles mirror m_formula (Admin, RND Formula) per rbac.js;
--  tools/gen-rls.js now lists these tables too, so a regenerated 008
--  must be applied AFTER this migration.
-- ============================================================

create table if not exists public.m_formula_lab (
  id          text primary key,
  ph_result   numeric,
  viscosity   text not null default '',
  bj          numeric,
  appearance  text not null default '',
  odor        text not null default '',
  tpc         text not null default '',
  ym          text not null default '',
  test_date   text not null default '',
  lab_ref     text not null default '',
  analyst     text not null default '',
  note        text not null default '',
  status      text not null default 'Draft',
  updated     text not null default '',
  by          text not null default ''
);

create table if not exists public.m_formula_stab (
  id             text primary key,
  start_date     text not null default '',
  protocol       text not null default '',
  weeks_total    integer not null default 0,
  weeks_observed integer not null default 0,
  obs            jsonb not null default '[]',
  note           text not null default '',
  status         text not null default 'Draft',
  updated        text not null default '',
  by             text not null default ''
);

create table if not exists public.m_formula_machine (
  id          text primary key,
  mixer_id    text not null default '',
  mixer_name  text not null default '',
  vessel      text not null default '',
  phases      jsonb not null default '[]',
  vacuum      text not null default '',
  note        text not null default '',
  status      text not null default 'Draft',
  updated     text not null default '',
  by          text not null default ''
);

-- ---------- RLS: same shape as m_formula (008) ----------
do $$
declare t text;
begin
  foreach t in array array['m_formula_lab', 'm_formula_stab', 'm_formula_machine'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.auth_role() = any (array[''Admin'', ''RND Formula'']))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.auth_role() = any (array[''Admin'', ''RND Formula''])) with check (public.auth_role() = any (array[''Admin'', ''RND Formula'']))', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.auth_role() = any (array[''Admin'', ''RND Formula'']))', t || '_delete', t);
  end loop;
end $$;