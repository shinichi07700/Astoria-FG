/* ============================================================
   AUDIT PRUNE - Admin housekeeping for the cloud audit_log.

   The trail is append-only by RLS design (no DELETE policy for any
   role), so pruning runs through the migration-015 security definer
   RPCs, which re-check the Admin role and enforce the 365-day
   retention floor server-side. Everything here is presentation and
   parameter shaping for those RPCs; the floor below MUST keep
   matching the one inside admin_prune_audit (see
   tests/audit-prune.test.js).
   ============================================================ */
window.AuditPrune = (function () {
  "use strict";

  var RETENTION_DAYS = 365;
  var WIB_MS = 7 * 60 * 60 * 1000;

  /* ---------- pure decisions (covered by tests/audit-prune.test.js) ---------- */

  /* Oldest calendar day (in WIB) the date picker may offer: the WIB date
     of now - RETENTION_DAYS. "" when the input is not a timestamp - a
     broken clock must not make the picker offer a prunable yesterday. */
  function floorDate(nowMs) {
    if (nowMs === null || nowMs === undefined || nowMs === "") return "";
    var n = Number(nowMs);
    if (!isFinite(n)) return "";
    var d = new Date(n - RETENTION_DAYS * 86400000 + WIB_MS);
    return d.toISOString().slice(0, 10);
  }

  /* "YYYY-MM-DD" -> ISO instant of that day's WIB midnight, the cutoff
     sent to admin_prune_audit: rows stamped BEFORE this instant go, the
     whole chosen WIB day survives. Plain dates only; anything else (and
     impossible dates like 2025-02-30) is refused with null. */
  function cutoffUtc(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return null;
    var y = +day.slice(0, 4), m = +day.slice(5, 7), d = +day.slice(8, 10);
    var ms = Date.UTC(y, m - 1, d);
    var t = new Date(ms);
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return new Date(ms - WIB_MS).toISOString();
  }

  function fmtBytes(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) return "-";
    var units = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return i === 0 ? v + " " + units[i] : v.toFixed(1) + " " + units[i];
  }

  /* WIB display stamp for the oldest entry; "-" when there is none
     (empty table) or the value cannot be parsed. */
  function fmtOldest(iso) {
    var ms = Date.parse(iso == null ? "" : iso);
    if (!isFinite(ms)) return "-";
    var d = new Date(ms + WIB_MS);
    function p(x) { return (x < 10 ? "0" : "") + x; }
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes());
  }

  /* ---------- RPC wiring (exercised in browser E2E) ---------- */

  function loadStats() {
    return SB.rpc("admin_audit_stats", {});
  }

  /* Resolves { removed } or rejects with the server's guard message
     (non-Admin, or cutoff newer than the 365-day floor). */
  function prune(day) {
    var cutoff = cutoffUtc(day);
    if (!cutoff) return Promise.reject(new Error("Pick a cutoff date at least " + RETENTION_DAYS + " days back."));
    return SB.rpc("admin_prune_audit", { cutoff: cutoff }).then(function (n) {
      return { removed: Number(n) || 0 };
    });
  }

  var api = {
    RETENTION_DAYS: RETENTION_DAYS,
    floorDate: floorDate, cutoffUtc: cutoffUtc,
    fmtBytes: fmtBytes, fmtOldest: fmtOldest,
    loadStats: loadStats, prune: prune
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
