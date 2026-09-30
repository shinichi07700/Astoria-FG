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
