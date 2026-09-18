/* ============================================================
   SB - tiny Supabase client (PostgREST + GoTrue over fetch).
   No external library needed, keeps the app dependency-free.
   ============================================================ */
window.SB = (function () {
  var cfg = null;
  var session = null;
  var SKEY = "astoria_sb_session";

  function init(url, key) {
    cfg = { url: String(url || "").replace(/\/+$/, ""), key: String(key || "") };
  }
  function enabled() { return !!(cfg && cfg.url && cfg.key); }

  /* ---------- session ---------- */
  function restore() {
    try { session = JSON.parse(localStorage.getItem(SKEY)); } catch (e) { session = null; }
    if (!session || !session.access_token) { session = null; }
    return session;
  }
  function persist() {
    if (session) localStorage.setItem(SKEY, JSON.stringify(session));
    else localStorage.removeItem(SKEY);
  }
  function me() { return session ? { uid: session.uid, email: session.email } : null; }

  function headers(withAuth) {
    var h = { apikey: cfg.key, "Content-Type": "application/json" };
    if (withAuth && session) h.Authorization = "Bearer " + session.access_token;
    return h;
  }
  function parse(r) {
    return r.text().then(function (t) {
      var j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      if (!r.ok) {
        var msg = (j && (j.error_description || j.msg || j.error)) || t || ("HTTP " + r.status);
        throw new Error(msg);
      }
      return j;
    });
  }
  function authPost(path, body) {
    return fetch(cfg.url + "/auth/v1/" + path, {
      method: "POST", headers: headers(false), body: JSON.stringify(body)
    }).then(parse);
  }
  function adopt(j, fallbackEmail) {
    session = {
      uid: (j.user && j.user.id) || (session && session.uid) || "",
      email: (j.user && j.user.email) || fallbackEmail || (session && session.email) || "",
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: Date.now() + (j.expires_in || 3600) * 1000
    };
    persist();
    return session;
  }
  function signIn(email, password) {
    return authPost("token?grant_type=password", { email: email, password: password })
      .then(function (j) { return adopt(j, email); });
  }
  function signOut() {
    var p = session
      ? fetch(cfg.url + "/auth/v1/logout", { method: "POST", headers: headers(true) }).catch(function () {})
      : Promise.resolve();
    return p.then(function () { session = null; persist(); });
  }
  function ensureToken() {
    if (!session) return Promise.reject(new Error("Not signed in"));
    if (Date.now() < (session.expires_at || 0) - 60000) return Promise.resolve(session);
    return authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(function (j) { return adopt(j); });
  }

  /* ---------- PostgREST ---------- */
  function rest(method, path, body, extra) {
    return ensureToken().then(function () {
      return fetch(cfg.url + "/rest/v1/" + path, {
        method: method,
        headers: Object.assign(headers(true), extra || {}),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(parse);
  }
  /* PostgREST caps pages at 1000 rows - walk offsets until short page */
  function selectAll(table, filter, order) {
    var out = [];
    function page(off) {
      var q = table + "?select=*&limit=1000&offset=" + off +
        (filter ? "&" + filter : "") + (order ? "&order=" + order : "");
      return rest("GET", q, undefined, { Range: off + "-" + (off + 999) })
        .then(function (rows) {
          out = out.concat(rows || []);
          return (rows || []).length === 1000 ? page(off + 1000) : out;
        });
    }
    return page(0);
  }
  function upsert(table, rows) {
    if (!rows || !rows.length) return Promise.resolve(null);
    return rest("POST", table, rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  }
  function insert(table, rows) {
    if (!rows || !rows.length) return Promise.resolve(null);
    return rest("POST", table, rows, { Prefer: "return=minimal" });
  }
  function remove(table, filter) {
    return rest("DELETE", table + (filter ? "?" + filter : ""), undefined, { Prefer: "return=minimal" });
  }

  return {
    init: init, enabled: enabled, restore: restore, me: me,
    signIn: signIn, signOut: signOut, ensureToken: ensureToken,
    selectAll: selectAll, upsert: upsert, insert: insert, remove: remove
  };
})();
