#!/usr/bin/env node
/* ============================================================
   copy-supabase.js - one-shot data migration old project -> new.

   Reads every business table from the SOURCE project and upserts
   it into the TARGET project via PostgREST, using both projects'
   service_role keys (RLS is bypassed by them; the anon key cannot
   read everything and cannot delete).

   Also recreates the auth accounts on the target (passwords are
   GoTrue hashes and cannot be copied) and rewrites the profiles
   rows onto the new user ids, preserving full_name / role / email /
   emp_id. Every migrated account gets a random one-time password
   and pw_temp=true, so the app forces a private password on first
   sign-in - same contract as supabase/create-user.ps1.

   bom_lines and audit_log have DB-generated ids: their rows are
   copied without id (delete-then-insert), so nothing else may
   reference bom_lines.id - verified none does.

   Usage
     node tools/copy-supabase.js \
       --from-url=https://<old-ref>.supabase.co --from-key=<service_role> \
       --to-url=https://<new-ref>.supabase.co   --to-key=<service_role>

   Env fallbacks: SRC_URL, SRC_KEY, DST_URL, DST_KEY.
   Idempotent: safe to re-run (merge-duplicates upserts; the two
   replace-mode tables are re-copied from scratch).
   ============================================================ */
'use strict';

/* FK-safe order, mirrors the app's TABLES registry in assets/js/sync.js
   (parents before dependents; m_supplier first because materials and the
   purchasing tables carry supplier_id). */
const TABLES = [
  { name: 'm_supplier',        pk: 'id' },
  { name: 'fg_master',         pk: 'id' },
  { name: 'materials',         pk: 'code' },
  { name: 'm_customer',        pk: 'id' },
  { name: 'm_formula',         pk: 'id' },
  { name: 'm_packaging',       pk: 'id' },
  { name: 'm_mixer',           pk: 'id' },
  { name: 'boms',              pk: 'id' },
  /* generated-always id: copy without it, full replace */
  { name: 'bom_lines',         pk: 'id', mode: 'replace', strip: ['id'] },
  { name: 'sims',              pk: 'id' },
  { name: 'requests',          pk: 'id' },
  { name: 't_sales_order',     pk: 'id' },
  { name: 't_purchase_req',    pk: 'id' },
  { name: 't_calloff',         pk: 'id' },
  { name: 't_work_order_bulk', pk: 'id' },
  { name: 't_purchase_order',  pk: 'id' },
  { name: 't_inventory_lot',   pk: 'id' },
  { name: 't_inventory_txn',   pk: 'id' },
  { name: 't_staging',         pk: 'id' },
  { name: 't_line_clearance',  pk: 'id' },
  { name: 't_ipc_record',      pk: 'id' },
  { name: 't_wo_bulk_phase',   pk: 'id' },
  { name: 't_btip_transfer',   pk: 'id' },
  { name: 't_work_order_pack', pk: 'id' },
  { name: 't_release',         pk: 'id' },
  { name: 't_fg_receipt',      pk: 'id' },
  { name: 't_delivery_order',  pk: 'id' },
  { name: 't_delivery_line',   pk: 'id' },
  { name: 't_fg_txn',          pk: 'id' },
  { name: 'audit_log',         pk: 'id', mode: 'replace', strip: ['id'] },
  { name: 'meta_kv',           pk: 'key' }
];

const PAGE = 1000;   /* Supabase default PostgREST max rows */
const BATCH = 500;

/* ---------- args ---------- */
function arg(name, env) {
  const pre = '--' + name + '=';
  const hit = process.argv.find((a) => a.startsWith(pre));
  return hit ? hit.slice(pre.length) : process.env[env] || '';
}

const FROM_URL = arg('from-url', 'SRC_URL').replace(/\/+$/, '');
const FROM_KEY = arg('from-key', 'SRC_KEY');
const TO_URL   = arg('to-url',   'DST_URL').replace(/\/+$/, '');
const TO_KEY   = arg('to-key',   'DST_KEY');

if (!FROM_URL || !FROM_KEY || !TO_URL || !TO_KEY) {
  console.error('usage: node tools/copy-supabase.js \\');
  console.error('         --from-url=https://<old>.supabase.co --from-key=<service_role> \\');
  console.error('         --to-url=https://<new>.supabase.co   --to-key=<service_role>');
  process.exit(1);
}

/* refuse anon keys - they look identical until requests start 403-ing */
function jwtRole(jwt) {
  const p = (jwt.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = p + '='.repeat((4 - (p.length % 4)) % 4);
  try {
    const json = JSON.parse(Buffer.from(pad, 'base64').toString('utf8'));
    return json.role || '';
  } catch { return ''; }
}
for (const [label, key] of [['--from-key', FROM_KEY], ['--to-key', TO_KEY]]) {
  const role = jwtRole(key);
  if (role !== 'service_role') {
    console.error(`${label} carries role "${role || '?'}" - this script needs the service_role key of each project (Dashboard > Project Settings > API)`);
    process.exit(1);
  }
}

/* ---------- http ---------- */
async function req(method, url, key, body, prefer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* html error page */ }
    if (!r.ok) {
      const j = json || {};
      const err = new Error(j.message || j.error_description || j.error || j.msg || text.slice(0, 200) || `HTTP ${r.status}`);
      err.status = r.status;
      err.code = j.code || '';
      throw err;
    }
    return json || [];
  } finally {
    clearTimeout(timer);
  }
}

function rest(project, path) { return project.url + '/rest/v1/' + path; }
function auth(project, path) { return project.url + '/auth/v1/' + path; }

async function readAll(project, table, order) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await req('GET', rest(project, `${table}?select=*&limit=${PAGE}&offset=${offset}`) + (order ? `&order=${order}.asc` : ''), project.key);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function upsertAll(project, table, pk, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await req('POST', rest(project, `${table}?on_conflict=${pk}`), project.key, chunk, 'resolution=merge-duplicates,return=minimal');
  }
}

function stripCols(rows, cols) {
  return rows.map((r) => {
    const c = Object.assign({}, r);
    cols.forEach((k) => delete c[k]);
    return c;
  });
}

function newTempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789@#';
  return Array.from({ length: 14 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function wibStamp() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace('Z', '').replace('T', ' ') + ' WIB';
}

const SRC = { url: FROM_URL, key: FROM_KEY };
const DST = { url: TO_URL,   key: TO_KEY };

/* ---------- phases ---------- */
async function copyTable(spec) {
  const rows = await readAll(SRC, spec.name, spec.name === 'audit_log' ? 'id' : spec.pk);
  if (!rows.length) { console.log(`  ${spec.name.padEnd(22)} 0 rows (skipped)`); return 0; }
  const payload = spec.strip ? stripCols(rows, spec.strip) : rows;
  if (spec.mode === 'replace') {
    await req('DELETE', rest(DST, `${spec.name}?${spec.pk}=not.is.null`), DST.key);
    for (let i = 0; i < payload.length; i += BATCH) {
      await req('POST', rest(DST, spec.name), DST.key, payload.slice(i, i + BATCH), 'return=minimal');
    }
  } else {
    await upsertAll(DST, spec.name, spec.pk, payload);
  }
  console.log(`  ${spec.name.padEnd(22)} ${String(rows.length).padStart(6)} rows`);
  return rows.length;
}

async function migrateUsers() {
  console.log('\nauth accounts + profiles');
  const profiles = await readAll(SRC, 'profiles', 'id');
  console.log(`  ${profiles.length} profile(s) on source`);
  const uidMap = {};
  const handed = [];

  for (const p of profiles) {
    const email = p.email;
    if (!email) { console.log(`  ! profile ${p.id} has no email - skipped (create it via create-user.ps1)`); continue; }
    const temp = newTempPassword();
    let uid = null;
    try {
      const res = await req('POST', auth(DST, 'admin/users'), DST.key, {
        email,
        password: temp,
        email_confirm: true,
        user_metadata: { full_name: p.full_name || '' }
      });
      uid = res.id || (res.user && res.user.id);
    } catch (e) {
      if (!/already registered|duplicate/i.test(e.message)) throw e;
      const found = await req('GET', auth(DST, `admin/users?filter=email&value=${encodeURIComponent(email)}&page=1&per_page=1`), DST.key);
      if (!found || !found.users || !found.users.length) { console.log(`  ! ${email}: exists but not found - skipped`); continue; }
      uid = found.users[0].id;
      console.log(`  = ${email}: account already exists - password left untouched`);
    }
    if (!uid) { console.log(`  ! ${email}: no uid returned - skipped`); continue; }
    uidMap[p.id] = uid;
    handed.push({ email, name: p.full_name || '', role: p.role || '', temp });
  }

  /* profiles onto the new uids - merge-duplicates over the rows
     handle_new_user already inserted with the default role */
  const profRows = profiles
    .filter((p) => uidMap[p.id])
    .map((p) => ({
      id: uidMap[p.id],
      full_name: p.full_name || '',
      role: p.role || 'PPIC',
      email: p.email || '',
      emp_id: p.emp_id || '',
      pw_temp: true,
      updated_at: new Date().toISOString()
    }));
  if (profRows.length) await upsertAll(DST, 'profiles', 'id', profRows);

  if (handed.length) {
    console.log('\n  one-time passwords (hand out once; app forces a private password on first sign-in):');
    for (const h of handed) console.log(`    ${h.email.padEnd(34)} ${h.role.padEnd(12)} ${h.temp}`);
  }
  return Object.keys(uidMap).length;
}

/* ---------- main ---------- */
(async () => {
  console.log(`source : ${FROM_URL}`);
  console.log(`target : ${TO_URL}`);
  console.log(`started: ${wibStamp()}`);

  const srcCounts = {};
  for (const spec of TABLES) {
    srcCounts[spec.name] = (await readAll(SRC, spec.name, spec.pk)).length;
  }
  const total = Object.values(srcCounts).reduce((a, b) => a + b, 0);
  console.log(`\nsource holds ${total} rows across ${TABLES.length} tables\n`);

  const users = await migrateUsers();

  console.log('\ndata tables');
  const dstCounts = {};
  for (const spec of TABLES) {
    dstCounts[spec.name] = await copyTable(spec);
  }

  console.log('\nverification (source -> target)');
  let bad = 0;
  for (const spec of TABLES) {
    const ok = srcCounts[spec.name] === dstCounts[spec.name];
    if (!ok) bad++;
    console.log(`  ${spec.name.padEnd(22)} ${String(srcCounts[spec.name]).padStart(6)} -> ${String(dstCounts[spec.name]).padStart(6)} ${ok ? '' : '  <-- MISMATCH'}`);
  }
  console.log(`\ndone: ${wibStamp()}  users=${users}  mismatches=${bad}`);
  if (bad) process.exit(2);
})().catch((e) => {
  console.error(`\nFAILED: ${e.message}${e.code ? ` (code ${e.code})` : ''}`);
  if (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message)) {
    console.error('a table is missing on the target - run supabase/schema.sql,');
    console.error('supabase/apply-002-to-013.sql and supabase/migrations/014_staff_emp_id.sql');
    console.error('in the NEW project\'s SQL Editor first (anon/service keys cannot run DDL).');
  }
  process.exit(1);
});
