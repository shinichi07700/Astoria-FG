/* ============================================================
   tools/gen-rls.js  -  Phase 6 server-side RBAC generator

   Reads the role/field/state-machine config in assets/js/rbac.js
   (the SAME data the UI enforces) and emits the RLS migration
   supabase/migrations/007_rls_policies.sql, so the client matrix
   and the database policies can never drift apart.

   Regenerate after any rbac.js change:   node tools/gen-rls.js

   Model:
     - SELECT  : open to every signed-in staff account (in the app every
                 role is a viewer of every page), so read never drifts.
     - INSERT / UPDATE / DELETE : scoped to the roles that own the table,
                 derived from rbac.js (masters, *_EDITORS, STATES transitions).
                 Admin is always included and bypasses the column guard.
     - fg_master : an extra BEFORE UPDATE trigger enforces the field matrix
                 (Regulatory owns Kode NA / expiry, RND Formula owns FFS, ...)
                 because RLS itself is row-scoped, not column-scoped.
     - append-only ledgers (t_inventory_txn / t_fg_txn) : writable by their
                 operators but deletable only by Admin; audit_log is
                 read + append for all staff, never updated/deleted.
   ============================================================ */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

/* ---- load rbac.js as data (no DOM / Store needed at load time) ---- */
global.window = global;
vm.runInThisContext(
  fs.readFileSync(path.join(__dirname, "..", "assets", "js", "rbac.js"), "utf8"),
  { filename: "rbac.js" }
);
var RBAC = global.window.RBAC;

function need(cond, msg) { if (!cond) { throw new Error("gen-rls: " + msg); } }
need(RBAC && Array.isArray(RBAC.ROLES), "rbac.js did not expose ROLES");

/* ---- helpers ---- */
function U() {                       /* union of role arrays, Admin first, de-duped */
  var out = ["Admin"];
  for (var i = 0; i < arguments.length; i++) {
    (arguments[i] || []).forEach(function (r) { if (out.indexOf(r) < 0) out.push(r); });
  }
  out.forEach(function (r) { need(RBAC.ROLES.indexOf(r) >= 0, "unknown role '" + r + "'"); });
  return out;
}
function rolesOf(stateName) {        /* every role that may sign a transition */
  var st = RBAC.STATES[stateName] || {}, out = [];
  (st.transitions || []).forEach(function (t) {
    (t.roles || []).forEach(function (r) { if (out.indexOf(r) < 0) out.push(r); });
  });
  return out;
}
var ALL = RBAC.ROLES.slice();

/* ---- table groups (emission order == migration order, for clean diffs) ---- */
var GROUPS = [
  ["Master data (owned per rbac.js MASTER_EDITORS / FG_EDITOR_ROLES)",
    ["fg_master", "m_customer", "m_formula", "m_packaging", "m_mixer"]],
  ["Open masters - the UI does not role-gate these, so every staff account may write",
    ["materials", "boms", "bom_lines", "sims", "requests", "meta_kv"]],
  ["Sales order + PPIC planning",
    ["t_sales_order", "t_purchase_req", "t_calloff", "t_work_order_bulk"]],
  ["Purchasing + warehouse inbound + lot ledger",
    ["t_purchase_order", "t_inventory_lot", "t_inventory_txn", "t_staging"]],
  ["QA/QC gates + production execution",
    ["t_line_clearance", "t_ipc_record", "t_wo_bulk_phase", "t_btip_transfer", "t_work_order_pack", "t_release"]],
  ["FG warehouse + outbound logistics",
    ["t_fg_receipt", "t_delivery_order", "t_delivery_line", "t_fg_txn"]]
];

/* ---- write-role map, DERIVED from rbac.js so client and server cannot drift ---- */
var W = {
  fg_master:         U(RBAC.FG_EDITOR_ROLES),
  m_customer:        U(RBAC.MASTER_EDITORS.customers),
  m_formula:         U(RBAC.MASTER_EDITORS.formulas),
  m_packaging:       U(RBAC.MASTER_EDITORS.packagings),
  m_mixer:           U(RBAC.MASTER_EDITORS.mixers),

  materials:         U(ALL), boms: U(ALL), bom_lines: U(ALL),
  sims:              U(ALL), requests: U(ALL), meta_kv: U(ALL),

  /* Marketing raises/edits/confirms, PPIC closes, Warehouse auto-closes on full delivery */
  t_sales_order:     U(RBAC.SO_EDITORS, rolesOf("salesOrder"), RBAC.DELIVERY),
  t_purchase_req:    U(RBAC.PPIC_PLANNERS, rolesOf("purchaseReq")),
  t_calloff:         U(RBAC.PPIC_PLANNERS),
  t_work_order_bulk: U(RBAC.PPIC_PLANNERS, rolesOf("workOrderBulk")),

  t_purchase_order:  U(RBAC.PURCHASERS, rolesOf("purchaseOrder")),
  /* receive, QA disposition and FG backflush all move RM lots / the RM ledger */
  t_inventory_lot:   U(RBAC.RECEIVERS, RBAC.QA_RELEASE, RBAC.FG_RECEIVERS),
  t_inventory_txn:   U(RBAC.RECEIVERS, RBAC.STAGERS, RBAC.QA_RELEASE, RBAC.FG_RECEIVERS),
  t_staging:         U(RBAC.STAGERS),

  t_line_clearance:  U(RBAC.QA_INSPECTORS),
  t_ipc_record:      U(RBAC.QA_INSPECTORS),
  t_wo_bulk_phase:   U(RBAC.PRODUCERS, RBAC.QA_INSPECTORS),
  t_btip_transfer:   U(RBAC.PRODUCERS),
  t_work_order_pack: U(RBAC.PPIC_PLANNERS, RBAC.PRODUCERS, rolesOf("workOrderPack")),
  t_release:         U(RBAC.QA_INSPECTORS, rolesOf("release")),

  t_fg_receipt:      U(RBAC.FG_RECEIVERS),
  t_delivery_order:  U(RBAC.DELIVERY),
  t_delivery_line:   U(RBAC.DELIVERY),
  t_fg_txn:          U(RBAC.FG_RECEIVERS, RBAC.DELIVERY)
};

/* append-only ledgers: operators may insert/update, only Admin may delete */
var APPEND_ONLY = { t_inventory_txn: true, t_fg_txn: true };

/* ---- fg_master column ownership, DERIVED from FG_FIELD_RIGHTS ---- */
var RIGHT_TO_COL = { ffs: "ffs", fps: "fps", desc: "deskripsi", na: "kode_na", exp: "tgl_expire", disc: "discontinue" };
var COL_ROLES = {};
Object.keys(RIGHT_TO_COL).forEach(function (right) {
  var col = RIGHT_TO_COL[right], roles = [];
  Object.keys(RBAC.FG_FIELD_RIGHTS).forEach(function (role) {
    if (RBAC.FG_FIELD_RIGHTS[role][right]) roles.push(role);
  });
  COL_ROLES[col] = U(roles);            /* Admin always allowed */
});

/* ---- SQL emission ---- */
function arr(roles) { return "array[" + roles.map(function (r) { return "'" + r + "'"; }).join(", ") + "]"; }
function q(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
var ALL_TABLES = GROUPS.reduce(function (a, g) { return a.concat(g[1]); }, []);

var out = [];
function w(s) { out.push(s === undefined ? "" : s); }

w("-- ============================================================");
w("--  007 - SERVER-SIDE RBAC (ROW LEVEL SECURITY) POLICIES");
w("--  GENERATED FILE - DO NOT EDIT BY HAND.");
w("--  Source of truth: assets/js/rbac.js   Regenerate: node tools/gen-rls.js");
w("--");
w("--  Replaces the blanket staff_all policy (schema.sql + migrations 002-006)");
w("--  with per-role WRITE policies derived from rbac.js, plus a column-ownership");
w("--  guard on fg_master. SELECT stays open to every signed-in staff account");
w("--  (in the app every role can view every page); Admin bypasses every gate.");
w("--  The UI role matrix remains the first line of defence - this is the second.");
w("--");
w("--  Apply AFTER 002-006 in the Supabase SQL Editor. Because a first full sync");
w("--  deletes + re-pushes every table, SIGN IN AS ADMIN once after applying so the");
w("--  seed upload is not blocked by the new write policies.");
w("-- ============================================================");
w();
w("-- ---------- role helper (security definer avoids profiles-RLS recursion) ----------");
w("create or replace function public.auth_role()");
w("returns text language sql stable security definer set search_path = public as $$");
w("  select role from public.profiles where id = auth.uid()");
w("$$;");
w();
w("-- ---------- drop the blanket staff_all policy on every business table ----------");
w("do $$");
w("declare t text;");
w("begin");
w("  foreach t in array array[" + ALL_TABLES.map(q).join(", ") + "] loop");
w("    execute format('drop policy if exists staff_all on public.%I', t);");
w("  end loop;");
w("end $$;");
w();
w("-- ---------- ensure RLS is enabled everywhere (idempotent) ----------");
w("do $$");
w("declare t text;");
w("begin");
w("  foreach t in array array[" + ALL_TABLES.concat(["audit_log", "profiles"]).map(q).join(", ") + "] loop");
w("    execute format('alter table public.%I enable row level security', t);");
w("  end loop;");
w("end $$;");

/* ---- per-table policies ---- */
GROUPS.forEach(function (g) {
  w();
  w("-- ============================================================");
  w("--  " + g[0]);
  w("-- ============================================================");
  g[1].forEach(function (t) {
    var roles = W[t];
    need(roles && roles.length, "no write-role map for table " + t);
    var a = arr(roles);
    var delRoles = APPEND_ONLY[t] ? ["Admin"] : roles;
    w();
    w("-- " + t + "  (write: " + roles.join(", ") + (APPEND_ONLY[t] ? "; delete: Admin only - append-only ledger" : "") + ")");
    w("drop policy if exists " + t + "_read on public." + t + ";");
    w("create policy " + t + "_read on public." + t + " for select to authenticated using (true);");
    w("drop policy if exists " + t + "_insert on public." + t + ";");
    w("create policy " + t + "_insert on public." + t + " for insert to authenticated with check (public.auth_role() = any (" + a + "));");
    w("drop policy if exists " + t + "_update on public." + t + ";");
    w("create policy " + t + "_update on public." + t + " for update to authenticated using (public.auth_role() = any (" + a + ")) with check (public.auth_role() = any (" + a + "));");
    w("drop policy if exists " + t + "_delete on public." + t + ";");
    w("create policy " + t + "_delete on public." + t + " for delete to authenticated using (public.auth_role() = any (" + arr(delRoles) + "));");
  });
});

/* ---- audit_log: read + append only ---- */
w();
w("-- ============================================================");
w("--  Audit trail - readable by all staff, append-only (no update/delete policy)");
w("-- ============================================================");
w("drop policy if exists audit_select on public.audit_log;");
w("create policy audit_select on public.audit_log for select to authenticated using (true);");
w("drop policy if exists audit_insert on public.audit_log;");
w("create policy audit_insert on public.audit_log for insert to authenticated with check (true);");
w("drop policy if exists audit_update on public.audit_log;");
w("drop policy if exists audit_delete on public.audit_log;");

/* ---- profiles: self-service + Admin role management ---- */
w();
w("-- ============================================================");
w("--  Profiles - each user reads all, writes only their own row; Admin may");
w("--  manage any row (Settings > role management is Admin-only in the UI).");
w("-- ============================================================");
w("drop policy if exists profiles_select on public.profiles;");
w("create policy profiles_select on public.profiles for select to authenticated using (true);");
w("drop policy if exists profiles_insert on public.profiles;");
w("create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());");
w("drop policy if exists profiles_update on public.profiles;");
w("create policy profiles_update on public.profiles for update to authenticated");
w("  using (id = auth.uid() or public.auth_role() = 'Admin')");
w("  with check (id = auth.uid() or public.auth_role() = 'Admin');");

/* ---- fg_master column-ownership guard ---- */
w();
w("-- ============================================================");
w("--  fg_master column-ownership guard (from rbac.js FG_FIELD_RIGHTS).");
w("--  RLS is row-scoped, so per-column ownership is enforced here: a role may");
w("--  update the row but only the columns it owns. Derived/system columns");
w("--  (kode_fg, status, diubah_oleh, waktu_update, updated_at) are unguarded.");
w("-- ============================================================");
w("create or replace function public.fg_master_column_guard()");
w("returns trigger language plpgsql security definer set search_path = public as $$");
w("declare r text := public.auth_role();");
w("begin");
w("  if r is null or r = 'Admin' then return new; end if;");
Object.keys(RIGHT_TO_COL).forEach(function (right) {
  var col = RIGHT_TO_COL[right], roles = COL_ROLES[col];
  w("  if (new." + col + " is distinct from old." + col + ") and not (r = any (" + arr(roles) + ")) then");
  w("    raise exception 'fg_master." + col + " is owned by " + roles.filter(function (x) { return x !== "Admin"; }).join(" / ") + " (current role: %)', r;");
  w("  end if;");
});
w("  return new;");
w("end $$;");
w("drop trigger if exists fg_master_column_guard on public.fg_master;");
w("create trigger fg_master_column_guard before update on public.fg_master");
w("  for each row execute function public.fg_master_column_guard();");
w();

var sql = out.join("\n") + "\n";
var dest = path.join(__dirname, "..", "supabase", "migrations", "007_rls_policies.sql");
fs.writeFileSync(dest, sql, "utf8");

/* ---- summary to stdout ---- */
var policyCount = (sql.match(/create policy/g) || []).length;
console.log("Wrote " + path.relative(process.cwd(), dest));
console.log("  tables policed : " + ALL_TABLES.length + " (+ audit_log, profiles)");
console.log("  create policy  : " + policyCount);
console.log("  column guard   : fg_master [" + Object.keys(RIGHT_TO_COL).map(function (k) { return RIGHT_TO_COL[k]; }).join(", ") + "]");
console.log("  roles          : " + RBAC.ROLES.length);
