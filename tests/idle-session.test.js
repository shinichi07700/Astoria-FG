/* ============================================================
   Golden-vector unit tests for the idle-session decision core:
   when a session counts as expired, and when an activity event
   is allowed to rewrite the shared last-active timestamp.
   Run: node tests/idle-session.test.js
   Exits non-zero on any failure. No external dependencies.
   ============================================================ */
global.window = {};                              /* idle-session.js assigns window.IdleSession at load */
var I = require("../assets/js/idle-session.js");

var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = (typeof want === "number")
    ? Math.abs(Number(got) - want) < 1e-6
    : got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}

var HOUR = 60 * 60 * 1000;
var T0 = 1760000000000;         /* any fixed epoch ms baseline */

/* ---------- expired(now, storedLastActive, limit) ----------
   storedLastActive is the RAW localStorage value, so it can be a
   numeric string, an empty string, null (key absent) or garbage. */
eq("expired: one second short of the hour stays live",
  I.expired(T0 + HOUR - 1000, String(T0), HOUR), false);
eq("expired: exactly the hour is expired",
  I.expired(T0 + HOUR, String(T0), HOUR), true);
eq("expired: past the hour is expired",
  I.expired(T0 + HOUR + 45 * 60 * 1000, String(T0), HOUR), true);
eq("expired: accepts a number as well as a string",
  I.expired(T0 + HOUR, T0, HOUR), true);
eq("expired: missing timestamp (never touched yet) stays live",
  I.expired(T0 + 3 * HOUR, null, HOUR), false);
eq("expired: empty string stays live",
  I.expired(T0 + 3 * HOUR, "", HOUR), false);
eq("expired: unparseable timestamp stays live",
  I.expired(T0 + 3 * HOUR, "not-a-number", HOUR), false);
eq("expired: a timestamp ahead of this clock stays live",
  I.expired(T0, String(T0 + 5 * 60 * 1000), HOUR), false);
eq("expired: honours a caller-supplied limit",
  I.expired(T0 + 10000, String(T0), 5000), true);

/* ---------- shouldWrite(now, storedLastWrite, gap) ----------
   Throttle guard so a twitchy mouse cannot spam localStorage. */
eq("shouldWrite: first write after boot always goes through",
  I.shouldWrite(T0 + 1000, null, 20000), true);
eq("shouldWrite: writes inside the gap are suppressed",
  I.shouldWrite(T0 + 19999, String(T0), 20000), false);
eq("shouldWrite: writes at the gap boundary go through",
  I.shouldWrite(T0 + 20000, String(T0), 20000), true);
eq("shouldWrite: an unparseable last write goes through",
  I.shouldWrite(T0 + 100000, "garbage", 20000), true);

console.log("\n" + (fails ? "RESULT: FAIL (" + fails + "/" + count + ")" : "RESULT: ALL PASS (" + count + " vectors)"));
process.exit(fails ? 1 : 0);
