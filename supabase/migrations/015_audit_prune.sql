-- ============================================================
--  015 - AUDIT LOG HOUSEKEEPING RPCs.
--  audit_log has select + insert RLS policies only - no DELETE policy on
--  purpose, so the trail stays append-only to every browser. Housekeeping
--  therefore runs through these security definer functions:
--
--    admin_audit_stats()      row count, oldest entry, total table size
--    admin_prune_audit(cutoff) deletes created_at < cutoff, returns count
--
--  Retention floor: the cutoff may never be newer than now() - 365 days,
--  and the check lives inside the function so a crafted API call cannot
--  bypass it any more than it can bypass the Admin guard. Row attribution
--  of the prune itself is written by the client through the normal
--  append-only insert path.
--
--  Apply after 008. Safe to re-run: create or replace only.
-- ============================================================

create or replace function public.admin_audit_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'audit stats is Admin-only (current role: %)',
      coalesce(public.auth_role(), 'no profile role');
  end if;
  return json_build_object(
    'row_count',  (select count(*) from public.audit_log),
    'oldest',     (select min(created_at) from public.audit_log),
    'size_bytes', pg_total_relation_size('public.audit_log')
  );
end $$;

create or replace function public.admin_prune_audit(cutoff timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare
  floor_ts timestamptz := now() - interval '365 days';
  removed  integer;
begin
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'audit prune is Admin-only (current role: %)',
      coalesce(public.auth_role(), 'no profile role');
  end if;

  if cutoff is null or cutoff > floor_ts then
    raise exception 'cutoff must be at least 365 days in the past (floor: %)', floor_ts;
  end if;

  delete from public.audit_log where created_at < cutoff;
  get diagnostics removed = row_count;
  return removed;
end $$;

revoke execute on function public.admin_audit_stats() from public, anon;
revoke execute on function public.admin_prune_audit(timestamptz) from public, anon;
grant execute on function public.admin_audit_stats() to authenticated;
grant execute on function public.admin_prune_audit(timestamptz) to authenticated;
