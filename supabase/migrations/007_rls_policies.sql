-- ============================================================
--  007 - SERVER-SIDE RBAC (ROW LEVEL SECURITY) POLICIES
--  GENERATED FILE - DO NOT EDIT BY HAND.
--  Source of truth: assets/js/rbac.js   Regenerate: node tools/gen-rls.js
--
--  Replaces the blanket staff_all policy (schema.sql + migrations 002-006)
--  with per-role WRITE policies derived from rbac.js, plus a column-ownership
--  guard on fg_master. SELECT stays open to every signed-in staff account
--  (in the app every role can view every page); Admin bypasses every gate.
--  The UI role matrix remains the first line of defence - this is the second.
--
--  Apply AFTER 002-006 in the Supabase SQL Editor. Because a first full sync
--  deletes + re-pushes every table, SIGN IN AS ADMIN once after applying so the
--  seed upload is not blocked by the new write policies.
-- ============================================================

-- ---------- role helper (security definer avoids profiles-RLS recursion) ----------
create or replace function public.auth_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- drop the blanket staff_all policy on every business table ----------
do $$
declare t text;
begin
  foreach t in array array['fg_master', 'm_customer', 'm_formula', 'm_packaging', 'm_mixer', 'materials', 'boms', 'bom_lines', 'sims', 'requests', 'meta_kv', 't_sales_order', 't_purchase_req', 't_calloff', 't_work_order_bulk', 't_purchase_order', 't_inventory_lot', 't_inventory_txn', 't_staging', 't_line_clearance', 't_ipc_record', 't_wo_bulk_phase', 't_btip_transfer', 't_work_order_pack', 't_release', 't_fg_receipt', 't_delivery_order', 't_delivery_line', 't_fg_txn'] loop
    execute format('drop policy if exists staff_all on public.%I', t);
  end loop;
end $$;

-- ---------- ensure RLS is enabled everywhere (idempotent) ----------
do $$
declare t text;
begin
  foreach t in array array['fg_master', 'm_customer', 'm_formula', 'm_packaging', 'm_mixer', 'materials', 'boms', 'bom_lines', 'sims', 'requests', 'meta_kv', 't_sales_order', 't_purchase_req', 't_calloff', 't_work_order_bulk', 't_purchase_order', 't_inventory_lot', 't_inventory_txn', 't_staging', 't_line_clearance', 't_ipc_record', 't_wo_bulk_phase', 't_btip_transfer', 't_work_order_pack', 't_release', 't_fg_receipt', 't_delivery_order', 't_delivery_line', 't_fg_txn', 'audit_log', 'profiles'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ============================================================
--  Master data (owned per rbac.js MASTER_EDITORS / FG_EDITOR_ROLES)
-- ============================================================

-- fg_master  (write: Admin, RND Formula, RND Kemas, Regulatory)
drop policy if exists fg_master_read on public.fg_master;
create policy fg_master_read on public.fg_master for select to authenticated using (true);
drop policy if exists fg_master_insert on public.fg_master;
create policy fg_master_insert on public.fg_master for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));
drop policy if exists fg_master_update on public.fg_master;
create policy fg_master_update on public.fg_master for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));
drop policy if exists fg_master_delete on public.fg_master;
create policy fg_master_delete on public.fg_master for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory']));

-- m_customer  (write: Admin, Marketing)
drop policy if exists m_customer_read on public.m_customer;
create policy m_customer_read on public.m_customer for select to authenticated using (true);
drop policy if exists m_customer_insert on public.m_customer;
create policy m_customer_insert on public.m_customer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_customer_update on public.m_customer;
create policy m_customer_update on public.m_customer for update to authenticated using (public.auth_role() = any (array['Admin', 'Marketing'])) with check (public.auth_role() = any (array['Admin', 'Marketing']));
drop policy if exists m_customer_delete on public.m_customer;
create policy m_customer_delete on public.m_customer for delete to authenticated using (public.auth_role() = any (array['Admin', 'Marketing']));

-- m_formula  (write: Admin, RND Formula)
drop policy if exists m_formula_read on public.m_formula;
create policy m_formula_read on public.m_formula for select to authenticated using (true);
drop policy if exists m_formula_insert on public.m_formula;
create policy m_formula_insert on public.m_formula for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula']));
drop policy if exists m_formula_update on public.m_formula;
create policy m_formula_update on public.m_formula for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula'])) with check (public.auth_role() = any (array['Admin', 'RND Formula']));
drop policy if exists m_formula_delete on public.m_formula;
create policy m_formula_delete on public.m_formula for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula']));

-- m_packaging  (write: Admin, RND Kemas)
drop policy if exists m_packaging_read on public.m_packaging;
create policy m_packaging_read on public.m_packaging for select to authenticated using (true);
drop policy if exists m_packaging_insert on public.m_packaging;
create policy m_packaging_insert on public.m_packaging for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Kemas']));
drop policy if exists m_packaging_update on public.m_packaging;
create policy m_packaging_update on public.m_packaging for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Kemas'])) with check (public.auth_role() = any (array['Admin', 'RND Kemas']));
drop policy if exists m_packaging_delete on public.m_packaging;
create policy m_packaging_delete on public.m_packaging for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Kemas']));

-- m_mixer  (write: Admin, PPIC, Production)
drop policy if exists m_mixer_read on public.m_mixer;
create policy m_mixer_read on public.m_mixer for select to authenticated using (true);
drop policy if exists m_mixer_insert on public.m_mixer;
create policy m_mixer_insert on public.m_mixer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));
drop policy if exists m_mixer_update on public.m_mixer;
create policy m_mixer_update on public.m_mixer for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));
drop policy if exists m_mixer_delete on public.m_mixer;
create policy m_mixer_delete on public.m_mixer for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production']));

-- ============================================================
--  Open masters - the UI does not role-gate these, so every staff account may write
-- ============================================================

-- materials  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated using (true);
drop policy if exists materials_insert on public.materials;
create policy materials_insert on public.materials for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists materials_update on public.materials;
create policy materials_update on public.materials for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists materials_delete on public.materials;
create policy materials_delete on public.materials for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- boms  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists boms_read on public.boms;
create policy boms_read on public.boms for select to authenticated using (true);
drop policy if exists boms_insert on public.boms;
create policy boms_insert on public.boms for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists boms_update on public.boms;
create policy boms_update on public.boms for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists boms_delete on public.boms;
create policy boms_delete on public.boms for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- bom_lines  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists bom_lines_read on public.bom_lines;
create policy bom_lines_read on public.bom_lines for select to authenticated using (true);
drop policy if exists bom_lines_insert on public.bom_lines;
create policy bom_lines_insert on public.bom_lines for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists bom_lines_update on public.bom_lines;
create policy bom_lines_update on public.bom_lines for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists bom_lines_delete on public.bom_lines;
create policy bom_lines_delete on public.bom_lines for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- sims  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists sims_read on public.sims;
create policy sims_read on public.sims for select to authenticated using (true);
drop policy if exists sims_insert on public.sims;
create policy sims_insert on public.sims for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists sims_update on public.sims;
create policy sims_update on public.sims for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists sims_delete on public.sims;
create policy sims_delete on public.sims for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- requests  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists requests_read on public.requests;
create policy requests_read on public.requests for select to authenticated using (true);
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists requests_update on public.requests;
create policy requests_update on public.requests for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists requests_delete on public.requests;
create policy requests_delete on public.requests for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- meta_kv  (write: Admin, RND Formula, RND Kemas, Regulatory, Marketing, PPIC, Purchasing, Warehouse, Production, QA, Finance)
drop policy if exists meta_kv_read on public.meta_kv;
create policy meta_kv_read on public.meta_kv for select to authenticated using (true);
drop policy if exists meta_kv_insert on public.meta_kv;
create policy meta_kv_insert on public.meta_kv for insert to authenticated with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists meta_kv_update on public.meta_kv;
create policy meta_kv_update on public.meta_kv for update to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance'])) with check (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));
drop policy if exists meta_kv_delete on public.meta_kv;
create policy meta_kv_delete on public.meta_kv for delete to authenticated using (public.auth_role() = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory', 'Marketing', 'PPIC', 'Purchasing', 'Warehouse', 'Production', 'QA', 'Finance']));

-- ============================================================
--  Sales order + PPIC planning
-- ============================================================

-- t_sales_order  (write: Admin, Marketing, PPIC, Warehouse)
drop policy if exists t_sales_order_read on public.t_sales_order;
create policy t_sales_order_read on public.t_sales_order for select to authenticated using (true);
drop policy if exists t_sales_order_insert on public.t_sales_order;
create policy t_sales_order_insert on public.t_sales_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));
drop policy if exists t_sales_order_update on public.t_sales_order;
create policy t_sales_order_update on public.t_sales_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));
drop policy if exists t_sales_order_delete on public.t_sales_order;
create policy t_sales_order_delete on public.t_sales_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Marketing', 'PPIC', 'Warehouse']));

-- t_purchase_req  (write: Admin, PPIC, Purchasing)
drop policy if exists t_purchase_req_read on public.t_purchase_req;
create policy t_purchase_req_read on public.t_purchase_req for select to authenticated using (true);
drop policy if exists t_purchase_req_insert on public.t_purchase_req;
create policy t_purchase_req_insert on public.t_purchase_req for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));
drop policy if exists t_purchase_req_update on public.t_purchase_req;
create policy t_purchase_req_update on public.t_purchase_req for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));
drop policy if exists t_purchase_req_delete on public.t_purchase_req;
create policy t_purchase_req_delete on public.t_purchase_req for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Purchasing']));

-- t_calloff  (write: Admin, PPIC)
drop policy if exists t_calloff_read on public.t_calloff;
create policy t_calloff_read on public.t_calloff for select to authenticated using (true);
drop policy if exists t_calloff_insert on public.t_calloff;
create policy t_calloff_insert on public.t_calloff for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC']));
drop policy if exists t_calloff_update on public.t_calloff;
create policy t_calloff_update on public.t_calloff for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC'])) with check (public.auth_role() = any (array['Admin', 'PPIC']));
drop policy if exists t_calloff_delete on public.t_calloff;
create policy t_calloff_delete on public.t_calloff for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC']));

-- t_work_order_bulk  (write: Admin, PPIC, Production, QA)
drop policy if exists t_work_order_bulk_read on public.t_work_order_bulk;
create policy t_work_order_bulk_read on public.t_work_order_bulk for select to authenticated using (true);
drop policy if exists t_work_order_bulk_insert on public.t_work_order_bulk;
create policy t_work_order_bulk_insert on public.t_work_order_bulk for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_bulk_update on public.t_work_order_bulk;
create policy t_work_order_bulk_update on public.t_work_order_bulk for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_bulk_delete on public.t_work_order_bulk;
create policy t_work_order_bulk_delete on public.t_work_order_bulk for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));

-- ============================================================
--  Purchasing + warehouse inbound + lot ledger
-- ============================================================

-- t_purchase_order  (write: Admin, Purchasing, Warehouse)
drop policy if exists t_purchase_order_read on public.t_purchase_order;
create policy t_purchase_order_read on public.t_purchase_order for select to authenticated using (true);
drop policy if exists t_purchase_order_insert on public.t_purchase_order;
create policy t_purchase_order_insert on public.t_purchase_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));
drop policy if exists t_purchase_order_update on public.t_purchase_order;
create policy t_purchase_order_update on public.t_purchase_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));
drop policy if exists t_purchase_order_delete on public.t_purchase_order;
create policy t_purchase_order_delete on public.t_purchase_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Purchasing', 'Warehouse']));

-- t_inventory_lot  (write: Admin, Warehouse, Purchasing, QA, Production)
drop policy if exists t_inventory_lot_read on public.t_inventory_lot;
create policy t_inventory_lot_read on public.t_inventory_lot for select to authenticated using (true);
drop policy if exists t_inventory_lot_insert on public.t_inventory_lot;
create policy t_inventory_lot_insert on public.t_inventory_lot for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));
drop policy if exists t_inventory_lot_update on public.t_inventory_lot;
create policy t_inventory_lot_update on public.t_inventory_lot for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));
drop policy if exists t_inventory_lot_delete on public.t_inventory_lot;
create policy t_inventory_lot_delete on public.t_inventory_lot for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'QA', 'Production']));

-- t_inventory_txn  (write: Admin, Warehouse, Purchasing, Production, QA; delete: Admin only - append-only ledger)
drop policy if exists t_inventory_txn_read on public.t_inventory_txn;
create policy t_inventory_txn_read on public.t_inventory_txn for select to authenticated using (true);
drop policy if exists t_inventory_txn_insert on public.t_inventory_txn;
create policy t_inventory_txn_insert on public.t_inventory_txn for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA']));
drop policy if exists t_inventory_txn_update on public.t_inventory_txn;
create policy t_inventory_txn_update on public.t_inventory_txn for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Purchasing', 'Production', 'QA']));
drop policy if exists t_inventory_txn_delete on public.t_inventory_txn;
create policy t_inventory_txn_delete on public.t_inventory_txn for delete to authenticated using (public.auth_role() = any (array['Admin']));

-- t_staging  (write: Admin, Warehouse, Production)
drop policy if exists t_staging_read on public.t_staging;
create policy t_staging_read on public.t_staging for select to authenticated using (true);
drop policy if exists t_staging_insert on public.t_staging;
create policy t_staging_insert on public.t_staging for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_staging_update on public.t_staging;
create policy t_staging_update on public.t_staging for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_staging_delete on public.t_staging;
create policy t_staging_delete on public.t_staging for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));

-- ============================================================
--  QA/QC gates + production execution
-- ============================================================

-- t_line_clearance  (write: Admin, QA)
drop policy if exists t_line_clearance_read on public.t_line_clearance;
create policy t_line_clearance_read on public.t_line_clearance for select to authenticated using (true);
drop policy if exists t_line_clearance_insert on public.t_line_clearance;
create policy t_line_clearance_insert on public.t_line_clearance for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_line_clearance_update on public.t_line_clearance;
create policy t_line_clearance_update on public.t_line_clearance for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_line_clearance_delete on public.t_line_clearance;
create policy t_line_clearance_delete on public.t_line_clearance for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- t_ipc_record  (write: Admin, QA)
drop policy if exists t_ipc_record_read on public.t_ipc_record;
create policy t_ipc_record_read on public.t_ipc_record for select to authenticated using (true);
drop policy if exists t_ipc_record_insert on public.t_ipc_record;
create policy t_ipc_record_insert on public.t_ipc_record for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_ipc_record_update on public.t_ipc_record;
create policy t_ipc_record_update on public.t_ipc_record for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_ipc_record_delete on public.t_ipc_record;
create policy t_ipc_record_delete on public.t_ipc_record for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- t_wo_bulk_phase  (write: Admin, Production, QA)
drop policy if exists t_wo_bulk_phase_read on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_read on public.t_wo_bulk_phase for select to authenticated using (true);
drop policy if exists t_wo_bulk_phase_insert on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_insert on public.t_wo_bulk_phase for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Production', 'QA']));
drop policy if exists t_wo_bulk_phase_update on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_update on public.t_wo_bulk_phase for update to authenticated using (public.auth_role() = any (array['Admin', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'Production', 'QA']));
drop policy if exists t_wo_bulk_phase_delete on public.t_wo_bulk_phase;
create policy t_wo_bulk_phase_delete on public.t_wo_bulk_phase for delete to authenticated using (public.auth_role() = any (array['Admin', 'Production', 'QA']));

-- t_btip_transfer  (write: Admin, Production)
drop policy if exists t_btip_transfer_read on public.t_btip_transfer;
create policy t_btip_transfer_read on public.t_btip_transfer for select to authenticated using (true);
drop policy if exists t_btip_transfer_insert on public.t_btip_transfer;
create policy t_btip_transfer_insert on public.t_btip_transfer for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Production']));
drop policy if exists t_btip_transfer_update on public.t_btip_transfer;
create policy t_btip_transfer_update on public.t_btip_transfer for update to authenticated using (public.auth_role() = any (array['Admin', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Production']));
drop policy if exists t_btip_transfer_delete on public.t_btip_transfer;
create policy t_btip_transfer_delete on public.t_btip_transfer for delete to authenticated using (public.auth_role() = any (array['Admin', 'Production']));

-- t_work_order_pack  (write: Admin, PPIC, Production, QA)
drop policy if exists t_work_order_pack_read on public.t_work_order_pack;
create policy t_work_order_pack_read on public.t_work_order_pack for select to authenticated using (true);
drop policy if exists t_work_order_pack_insert on public.t_work_order_pack;
create policy t_work_order_pack_insert on public.t_work_order_pack for insert to authenticated with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_pack_update on public.t_work_order_pack;
create policy t_work_order_pack_update on public.t_work_order_pack for update to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA'])) with check (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));
drop policy if exists t_work_order_pack_delete on public.t_work_order_pack;
create policy t_work_order_pack_delete on public.t_work_order_pack for delete to authenticated using (public.auth_role() = any (array['Admin', 'PPIC', 'Production', 'QA']));

-- t_release  (write: Admin, QA)
drop policy if exists t_release_read on public.t_release;
create policy t_release_read on public.t_release for select to authenticated using (true);
drop policy if exists t_release_insert on public.t_release;
create policy t_release_insert on public.t_release for insert to authenticated with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_release_update on public.t_release;
create policy t_release_update on public.t_release for update to authenticated using (public.auth_role() = any (array['Admin', 'QA'])) with check (public.auth_role() = any (array['Admin', 'QA']));
drop policy if exists t_release_delete on public.t_release;
create policy t_release_delete on public.t_release for delete to authenticated using (public.auth_role() = any (array['Admin', 'QA']));

-- ============================================================
--  FG warehouse + outbound logistics
-- ============================================================

-- t_fg_receipt  (write: Admin, Warehouse, Production)
drop policy if exists t_fg_receipt_read on public.t_fg_receipt;
create policy t_fg_receipt_read on public.t_fg_receipt for select to authenticated using (true);
drop policy if exists t_fg_receipt_insert on public.t_fg_receipt;
create policy t_fg_receipt_insert on public.t_fg_receipt for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_receipt_update on public.t_fg_receipt;
create policy t_fg_receipt_update on public.t_fg_receipt for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_receipt_delete on public.t_fg_receipt;
create policy t_fg_receipt_delete on public.t_fg_receipt for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));

-- t_delivery_order  (write: Admin, Warehouse)
drop policy if exists t_delivery_order_read on public.t_delivery_order;
create policy t_delivery_order_read on public.t_delivery_order for select to authenticated using (true);
drop policy if exists t_delivery_order_insert on public.t_delivery_order;
create policy t_delivery_order_insert on public.t_delivery_order for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_order_update on public.t_delivery_order;
create policy t_delivery_order_update on public.t_delivery_order for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_order_delete on public.t_delivery_order;
create policy t_delivery_order_delete on public.t_delivery_order for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse']));

-- t_delivery_line  (write: Admin, Warehouse)
drop policy if exists t_delivery_line_read on public.t_delivery_line;
create policy t_delivery_line_read on public.t_delivery_line for select to authenticated using (true);
drop policy if exists t_delivery_line_insert on public.t_delivery_line;
create policy t_delivery_line_insert on public.t_delivery_line for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_line_update on public.t_delivery_line;
create policy t_delivery_line_update on public.t_delivery_line for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse'])) with check (public.auth_role() = any (array['Admin', 'Warehouse']));
drop policy if exists t_delivery_line_delete on public.t_delivery_line;
create policy t_delivery_line_delete on public.t_delivery_line for delete to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse']));

-- t_fg_txn  (write: Admin, Warehouse, Production; delete: Admin only - append-only ledger)
drop policy if exists t_fg_txn_read on public.t_fg_txn;
create policy t_fg_txn_read on public.t_fg_txn for select to authenticated using (true);
drop policy if exists t_fg_txn_insert on public.t_fg_txn;
create policy t_fg_txn_insert on public.t_fg_txn for insert to authenticated with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_txn_update on public.t_fg_txn;
create policy t_fg_txn_update on public.t_fg_txn for update to authenticated using (public.auth_role() = any (array['Admin', 'Warehouse', 'Production'])) with check (public.auth_role() = any (array['Admin', 'Warehouse', 'Production']));
drop policy if exists t_fg_txn_delete on public.t_fg_txn;
create policy t_fg_txn_delete on public.t_fg_txn for delete to authenticated using (public.auth_role() = any (array['Admin']));

-- ============================================================
--  Audit trail - readable by all staff, append-only (no update/delete policy)
-- ============================================================
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (true);
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated with check (true);
drop policy if exists audit_update on public.audit_log;
drop policy if exists audit_delete on public.audit_log;

-- ============================================================
--  Profiles - each user reads all, writes only their own row; Admin may
--  manage any row (Settings > role management is Admin-only in the UI).
-- ============================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.auth_role() = 'Admin')
  with check (id = auth.uid() or public.auth_role() = 'Admin');

-- ============================================================
--  fg_master column-ownership guard (from rbac.js FG_FIELD_RIGHTS).
--  RLS is row-scoped, so per-column ownership is enforced here: a role may
--  update the row but only the columns it owns. Derived/system columns
--  (kode_fg, status, diubah_oleh, waktu_update, updated_at) are unguarded.
-- ============================================================
create or replace function public.fg_master_column_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.auth_role();
begin
  if r is null or r = 'Admin' then return new; end if;
  if (new.ffs is distinct from old.ffs) and not (r = any (array['Admin', 'RND Formula', 'Regulatory'])) then
    raise exception 'fg_master.ffs is owned by RND Formula / Regulatory (current role: %)', r;
  end if;
  if (new.fps is distinct from old.fps) and not (r = any (array['Admin', 'RND Kemas'])) then
    raise exception 'fg_master.fps is owned by RND Kemas (current role: %)', r;
  end if;
  if (new.deskripsi is distinct from old.deskripsi) and not (r = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) then
    raise exception 'fg_master.deskripsi is owned by RND Formula / RND Kemas / Regulatory (current role: %)', r;
  end if;
  if (new.kode_na is distinct from old.kode_na) and not (r = any (array['Admin', 'Regulatory'])) then
    raise exception 'fg_master.kode_na is owned by Regulatory (current role: %)', r;
  end if;
  if (new.tgl_expire is distinct from old.tgl_expire) and not (r = any (array['Admin', 'Regulatory'])) then
    raise exception 'fg_master.tgl_expire is owned by Regulatory (current role: %)', r;
  end if;
  if (new.discontinue is distinct from old.discontinue) and not (r = any (array['Admin', 'RND Formula', 'RND Kemas', 'Regulatory'])) then
    raise exception 'fg_master.discontinue is owned by RND Formula / RND Kemas / Regulatory (current role: %)', r;
  end if;
  return new;
end $$;
drop trigger if exists fg_master_column_guard on public.fg_master;
create trigger fg_master_column_guard before update on public.fg_master
  for each row execute function public.fg_master_column_guard();

