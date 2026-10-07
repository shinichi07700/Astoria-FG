/* ============================================================
   IDLE SESSION - ends the session after an hour without input.

   The last activity timestamp lives in ONE localStorage key, so
   every open tab shares it: working in one tab keeps the others
   alive, and an hour spent on a closed page still counts as idle
   after a reload. Each tab runs its own cheap checker, so all
   tabs sign out together.

   Client-side by nature: it protects an unattended shared
   terminal and the audit trail's "who typed this" attribution.
   The cloud path additionally revokes the refresh token through
   SB.signOut(), which is the part with real effect server-side.
   ============================================================ */
window.IdleSession = (function () {
  "use strict";

  var LIMIT_MS = 60 * 60 * 1000;
  var WRITE_GAP_MS = 20 * 1000;
  var CHECK_MS = 30 * 1000;
  var ACTIVE_KEY = "astoria_last_active";
  var NOTICE_KEY = "astoria_idle_out";
  var EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];

  var timer = null;
  var lastWrite = 0;

  /* ---------- pure decisions (covered by tests/idle-session.test.js) ----------
     `stored` is a raw storage value: numeric string, "", null or garbage.
     Anything unreadable is treated as "just active", never as expired - a
     corrupt key must not throw a working user off their own session. */
  function ms(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function expired(now, stored, limit) {
    var last = ms(stored);
    return last !== null && now - last >= limit;
  }
  function shouldWrite(now, stored, gap) {
    var last = ms(stored);
    return last === null || now - last >= gap;
  }

  /* ---------- storage (unavailable in private mode, so always guarded) ---------- */
  function read(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  /* ---------- activity ---------- */
  function touch() {
    var now = Date.now();
    /* the in-memory copy answers the common burst of events; the stored
       value is still consulted until this tab has written once, so another
       tab's activity is respected from the first second */
    if (!shouldWrite(now, lastWrite || read(ACTIVE_KEY), WRITE_GAP_MS)) return;
    lastWrite = now;
    write(ACTIVE_KEY, String(now));
  }

  function check(onExpire) {
    if (expired(Date.now(), read(ACTIVE_KEY), LIMIT_MS)) {
      stop();
      onExpire();
    }
  }

  function start(onExpire) {
    stop();
    touch();
    EVENTS.forEach(function (ev) {
      window.addEventListener(ev, touch, { capture: true, passive: true });
    });
    document.addEventListener("visibilitychange", touch);
    timer = setInterval(function () { check(onExpire); }, CHECK_MS);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    EVENTS.forEach(function (ev) {
      window.removeEventListener(ev, touch, { capture: true });
    });
    document.removeEventListener("visibilitychange", touch);
    lastWrite = 0;
  }

  /* sessionStorage, not a variable: the sign-out reloads the page, and the
     notice belongs to the tab that timed out, not to its neighbours. */
  function markNotice() {
    try { sessionStorage.setItem(NOTICE_KEY, "1"); } catch (e) {}
  }
  function takeNotice() {
    try {
      var v = sessionStorage.getItem(NOTICE_KEY);
      if (v) sessionStorage.removeItem(NOTICE_KEY);
      return !!v;
    } catch (e) { return false; }
  }

  var api = {
    expired: expired, shouldWrite: shouldWrite,
    start: start, stop: stop, touch: touch,
    markNotice: markNotice, takeNotice: takeNotice
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
