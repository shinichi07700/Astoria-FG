-- ============================================================
--  019 - AUDIT RETENTION RAISED TO 2 YEARS (730 DAYS).
--  The BOD needs a full two-year audit search window, so the prune
--  floor moves from now() - 365 days (migration 015) to
--  now() - 730 days. Only admin_prune_audit changes; the Admin
--  guard and the append-only RLS design are untouched. Raising the
--  floor deletes nothing - it only protects more rows.
--
--  Client mirror: assets/js/audit-prune.js RETENTION_DAYS = 730
--  (contract pinned by tests/audit-prune.test.js - change both).
--
--  Run ONCE in: Supabase Dashboard > SQL Editor (the anon key cannot
--  execute DDL). Apply after 015. Safe to re-run: create or replace
--  only; grants are re-issued so the file is self-contained.
-- ============================================================

create or replace function public.admin_prune_audit(cutoff timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare
  floor_ts timestamptz := now() - interval '730 days';
  removed  integer;
begin
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'audit prune is Admin-only (current role: %)',
      coalesce(public.auth_role(), 'no profile role');
  end if;

  if cutoff is null or cutoff > floor_ts then
    raise exception 'cutoff must be at least 730 days in the past (floor: %)', floor_ts;
  end if;

  delete from public.audit_log where created_at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.admin_prune_audit(timestamptz) from public, anon;
grant execute on function public.admin_prune_audit(timestamptz) to authenticated;
