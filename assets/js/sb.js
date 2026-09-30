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
        var err = new Error(msg);
        err.status = r.status;
        err.code = (j && j.code) || "";
        throw err;
      }
      return j;
    });
  }
  function authRequest(method, path, body, withAuth) {
    return fetch(cfg.url + "/auth/v1/" + path, {
      method: method, headers: headers(!!withAuth),
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(parse);
  }
  function authPost(path, body) {
    return authRequest("POST", path, body, false);
  }
  /* GoTrue self-service update: PUT /auth/v1/user carries the caller's own
     access token, so it can only ever change the signed-in account (used here
     to change your own password). Touching anybody ELSE's account needs the
     /auth/v1/admin API and the service_role key, which must never reach a
     browser - that is why this app cannot create or delete staff accounts. */
  function updateUser(body) {
    return ensureToken().then(function () {
      return authRequest("PUT", "user", body, true);
    });
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
  /* Column-existence probe. PostgREST validates the select list against the
     schema cache before RLS filters any row, so an empty table still answers:
     200 means the column is there, 42703 / PGRST204 means it is not. Callers
     use it to pick a row shape instead of guessing from a hydrated row. */
  function hasColumn(table, column) {
    return rest("GET", table + "?select=" + encodeURIComponent(column) + "&limit=1")
      .then(function () { return true; })
      .catch(function (err) {
        if (err && (err.code === "42703" || err.code === "PGRST204" ||
            err.code === "42P01" || err.code === "PGRST205" ||
            /could not find the column/i.test(err.message || ""))) return false;
        throw err;
      });
  }
  function upsert(table, rows) {
    if (!rows || !rows.length) return Promise.resolve(null);
    return rest("POST", table, rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
  }
  /* Filtered single-row update. A PATCH with no filter rewrites the whole
     table, so refuse rather than rely on every caller remembering one. */
  function patch(table, filter, body) {
    if (!filter) return Promise.reject(new Error("SB.patch requires a filter"));
    return rest("PATCH", table + "?" + filter, body, { Prefer: "return=representation" });
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
    signIn: signIn, signOut: signOut, ensureToken: ensureToken, updateUser: updateUser,
    selectAll: selectAll, hasColumn: hasColumn,
    upsert: upsert, patch: patch, insert: insert, remove: remove
  };
})();
