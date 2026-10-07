/* ============================================================
   Golden-vector unit tests for the audit-log housekeeping core:
   the client-side mirror of migration 015's retention rules -
   the 365-day floor the date picker may never go past, the WIB
   cutoff instant sent to admin_prune_audit, and the stat
   formatters shown in the Settings & Data card.
   Run: node tests/audit-prune.test.js
   Exits non-zero on any failure. No external dependencies.
   ============================================================ */
global.window = {};                              /* audit-prune.js assigns window.AuditPrune at load */
var A = require("../assets/js/audit-prune.js");

var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}

/* Retention floor contract with supabase/migrations/015_audit_prune.sql
   (now() - interval '365 days'). If either side changes, change both. */
eq("retention floor matches migration 015", A.RETENTION_DAYS, 365);

/* ---------- floorDate(nowMs) - oldest day the picker may offer, in WIB ---------- */
var T0 = Date.UTC(2026, 9, 7);                   /* 2026-10-07T00:00:00Z */
eq("floorDate: mid-day UTC lands on the calendar date 365 days back",
  A.floorDate(T0), "2025-10-07");
eq("floorDate: 14:00Z stays on the same WIB date",
  A.floorDate(T0 + 14 * 3600000), "2025-10-07");
eq("floorDate: 16:59Z is still 23:59 WIB of the day before",
  A.floorDate(Date.UTC(2026, 9, 6, 16, 59)), "2025-10-06");
eq("floorDate: 17:00Z is exactly WIB midnight, rolling the date forward",
  A.floorDate(Date.UTC(2026, 9, 6, 17, 0)), "2025-10-07");
eq("floorDate: non-finite input yields no floor",
  A.floorDate("not-a-number"), "");
eq("floorDate: missing input yields no floor",
  A.floorDate(null), "");

/* ---------- cutoffUtc("YYYY-MM-DD") - the instant sent to admin_prune_audit.
   The prune deletes created_at < cutoff, so the cutoff must be WIB midnight
   of the chosen day: every row stamped on that WIB date survives, everything
   strictly before it goes. ---------- */
eq("cutoffUtc: chosen day becomes its WIB-midnight instant",
  A.cutoffUtc("2025-10-07"), "2025-10-06T17:00:00.000Z");
eq("cutoffUtc: year boundary is handled in UTC terms",
  A.cutoffUtc("2026-01-01"), "2025-12-31T17:00:00.000Z");
eq("cutoffUtc: empty string is refused",
  A.cutoffUtc(""), null);
eq("cutoffUtc: garbage is refused",
  A.cutoffUtc("garbage"), null);
eq("cutoffUtc: datetime strings are refused (plain dates only)",
  A.cutoffUtc("2025-10-07T10:00"), null);
eq("cutoffUtc: impossible calendar dates are refused",
  A.cutoffUtc("2025-02-30"), null);

/* ---------- fmtBytes - the table size readout ---------- */
eq("fmtBytes: zero", A.fmtBytes(0), "0 B");
eq("fmtBytes: sub-kilobyte stays in bytes", A.fmtBytes(736), "736 B");
eq("fmtBytes: one byte below the boundary", A.fmtBytes(1023), "1023 B");
eq("fmtBytes: exact kilobyte boundary", A.fmtBytes(1024), "1.0 KB");
eq("fmtBytes: real audit_log size probe value", A.fmtBytes(90112), "88.0 KB");
eq("fmtBytes: megabytes with one decimal", A.fmtBytes(1572864), "1.5 MB");
eq("fmtBytes: gigabytes", A.fmtBytes(1073741824), "1.0 GB");
eq("fmtBytes: non-numeric input shows a dash", A.fmtBytes("big"), "-");
eq("fmtBytes: negative input shows a dash", A.fmtBytes(-5), "-");

/* ---------- fmtOldest - WIB display of the oldest entry ---------- */
eq("fmtOldest: migrated timestamp shifts to WIB",
  A.fmtOldest("2026-09-18T15:33:44.351836+00:00"), "2026-09-18 22:33");
eq("fmtOldest: a 17:30Z stamp is already the next WIB day",
  A.fmtOldest("2026-01-01T17:30:00Z"), "2026-01-02 00:30");
eq("fmtOldest: empty table (no oldest) shows a dash",
  A.fmtOldest(null), "-");
eq("fmtOldest: unparseable value shows a dash",
  A.fmtOldest("not-a-date"), "-");

console.log("\n" + (fails ? "RESULT: FAIL (" + fails + "/" + count + ")" : "RESULT: ALL PASS (" + count + " vectors)"));
process.exit(fails ? 1 : 0);
