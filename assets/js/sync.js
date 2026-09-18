/* ============================================================
   SYNC - Supabase bridge.
   Supabase is the system of record; the app keeps a fast local
   working copy (localStorage). On boot we hydrate from the
   cloud, every local change is marked dirty and pushed back
   (debounced). Offline changes stay queued and flush when the
   connection returns.
   ============================================================ */
window.Sync = (function () {
  var PKEY = "astoria_sync_pending";
  var pending = {};          // "table:key" -> { table, key, op: "upsert"|"delete" }
  var auditQueue = 0;        // number of audit rows not yet pushed
  var replaceAll = false;    // full-replace push (after backup import / reset)
  var status = "local";      // local | login | syncing | cloud | offline
  var timer = null;
  var listeners = [];
  var profile = null;
  var localRowsBefore = 0;   // local rows present before first cloud hydrate
  var lastCloudEmpty = false;
  var localSnapshot = null;  // deep copy of local store taken before hydrate

  function enabled() {
    return !!(window.ASTORIA_SUPABASE && window.ASTORIA_SUPABASE.url && window.ASTORIA_SUPABASE.anonKey);
  }
  function getStatus() { return status; }
  function onChange(fn) { listeners.push(fn); }
  function setStatus(s) {
    status = s;
    listeners.forEach(function (fn) { fn(s); });
  }
  function pendingCount() { return Object.keys(pending).length + auditQueue + (replaceAll ? 1 : 0); }

  /* ---------- dirty tracking ---------- */
  function loadPending() {
    try {
      var raw = JSON.parse(localStorage.getItem(PKEY) || "{}");
      pending = raw.marks || {};
      auditQueue = raw.audit || 0;
      replaceAll = !!raw.replaceAll;
    } catch (e) { pending = {}; auditQueue = 0; replaceAll = false; }
  }
  function savePending() {
    localStorage.setItem(PKEY, JSON.stringify({ marks: pending, audit: auditQueue, replaceAll: replaceAll }));
  }
  function mark(table, key, op) {
    if (!enabled()) return;
    pending[table + ":" + key] = { table: table, key: key, op: op || "upsert" };
    savePending();
    flushSoon();
  }
  function markAudit() { if (!enabled()) return; auditQueue++; savePending(); flushSoon(); }
  function markAll() { if (!enabled()) return; replaceAll = true; savePending(); flushSoon(); }

  /* ---------- row mappers (camelCase <-> snake_case) ---------- */
  function fgRow(f) {
    return {
      id: f.id, ffs: f.ffs, fps: f.fps, deskripsi: f.deskripsi || "",
      kode_na: f.kodeNA || "", tgl_expire: f.tglExpire || "", discontinue: !!f.discontinue,
      kode_fg: f.kodeFG || "", status: f.status || "",
      diubah_oleh: f.diubahOleh || "", waktu_update: f.waktuUpdate || ""
    };
  }
  function fgFrom(r) {
    return {
      id: r.id, ffs: r.ffs, fps: r.fps, deskripsi: r.deskripsi,
      kodeNA: r.kode_na, tglExpire: r.tgl_expire, discontinue: !!r.discontinue,
      diubahOleh: r.diubah_oleh, waktuUpdate: r.waktu_update,
      kodeFG: r.kode_fg, status: r.status
    };
  }
  function matRow(m) {
    return {
      code: m.code, name: m.name, category: m.category, unit: m.unit,
      stock_qty: Number(m.stockQty) || 0, stocked: m.stocked !== false, supplier: m.supplier || ""
    };
  }
  function matFrom(r) {
    return {
      code: r.code, name: r.name, category: r.category, unit: r.unit,
      stockQty: Number(r.stock_qty) || 0, stocked: !!r.stocked, supplier: r.supplier
    };
  }
  function bomRow(b) {
    return {
      id: b.id, no_bom: b.noBom, fg_id: b.fgId, revision: Number(b.revision) || 0,
      mulai_berlaku: b.mulaiBerlaku || "", customer: b.customer || "", no_customer: b.noCustomer || "",
      bulk_code: b.bulkCode || "", batch_size: b.batchSize || "",
      batch_yield: Number(b.batchYield) || 0, status: b.status || ""
    };
  }
  function lineRow(bomId, it, i) {
    return {
      bom_id: bomId, sort: i, section: it.section, material_code: it.materialCode,
      qty_per_unit: Number(it.qtyPerUnit) || 0, qty_per_batch: Number(it.qtyPerBatch) || 0,
      unit: it.unit || "", supported_by: it.supportedBy || "",
      loss_pct: Number(it.lossPct) || 0, note: it.note || ""
    };
  }

  /* ---------- hydrate: cloud -> local working copy ---------- */
  function hydrate() {
    return Promise.all([
      SB.selectAll("fg_master"),
      SB.selectAll("materials"),
      SB.selectAll("boms"),
      SB.selectAll("bom_lines", "", "bom_id,sort"),
      SB.selectAll("sims", "", "created_at.desc"),
      SB.selectAll("requests", "", "created_at.desc"),
      SB.selectAll("audit_log", "", "id.desc"),
      SB.selectAll("meta_kv")
    ]).then(function (res) {
      var fgRows = res[0], matRows = res[1], bomRows = res[2], lineRows = res[3];
      var simRows = res[4], reqRows = res[5], auditRows = res[6], kvRows = res[7];

      var linesByBom = {};
      lineRows.forEach(function (l) {
        (linesByBom[l.bom_id] = linesByBom[l.bom_id] || []).push({
          section: l.section, materialCode: l.material_code,
          qtyPerUnit: Number(l.qty_per_unit) || 0, qtyPerBatch: Number(l.qty_per_batch) || 0,
          unit: l.unit, supportedBy: l.supported_by, lossPct: Number(l.loss_pct) || 0, note: l.note
        });
      });

      var kv = (kvRows.filter(function (k) { return k.key === "app"; })[0] || {}).value || {};
      lastCloudEmpty = !fgRows.length && !matRows.length && !bomRows.length &&
        !simRows.length && !reqRows.length;
      var local = Store.get();
      var db = {
        meta: {
          app: "Astoria F/G Master & BOM Suite",
          version: 1,
          company: kv.company || (local.meta && local.meta.company) || "PT ASTORIA PRIMA",
          user: local.meta.user,
          seq: kv.seq || { bom: 0, mr: 0, pr: 0, sim: 0 },
          expWarnDays: kv.expWarnDays != null ? kv.expWarnDays : 90
        },
        fgs: fgRows.map(fgFrom),
        materials: matRows.map(matFrom),
        boms: bomRows.map(function (b) {
          return {
            id: b.id, noBom: b.no_bom, fgId: b.fg_id, revision: b.revision,
            mulaiBerlaku: b.mulai_berlaku, customer: b.customer, noCustomer: b.no_customer,
            bulkCode: b.bulk_code, batchSize: b.batch_size, batchYield: Number(b.batch_yield) || 0,
            status: b.status, items: linesByBom[b.id] || []
          };
        }),
        sims: simRows.map(function (r) { return r.payload; }),
        requests: reqRows.map(function (r) { return r.payload; }),
        audit: auditRows.slice(0, 1000).map(function (r) {
          return { ts: r.ts, user: r.user_name, role: r.role, action: r.action, entity: r.entity, detail: r.detail };
        })
      };
      /* Refresh / re-login race: the debounced push may not have run before
         this hydrate replaced the working copy, and the cloud still holds
         the pre-edit rows. Re-apply every change waiting in the push queue
         on top of the cloud copy so edits survive and the next flush sends
         the real values (instead of re-uploading stale cloud rows). */
      var dirty = {};
      Object.keys(pending).forEach(function (k) {
        var m = pending[k];
        (dirty[m.table] = dirty[m.table] || []).push(m);
      });
      function reapply(tbl, arrName, keyField) {
        (dirty[tbl] || []).forEach(function (m) {
          db[arrName] = db[arrName].filter(function (x) { return String(x[keyField]) !== String(m.key); });
          if (m.op !== "delete") {
            var lr = (local[arrName] || []).filter(function (x) { return String(x[keyField]) === String(m.key); })[0];
            if (lr) db[arrName].push(JSON.parse(JSON.stringify(lr)));
          }
        });
      }
      reapply("fg_master", "fgs", "id");
      reapply("materials", "materials", "code");
      reapply("boms", "boms", "id");
      reapply("sims", "sims", "id");
      reapply("requests", "requests", "id");
      if (auditQueue > 0 && local.audit && local.audit.length) {
        /* keep unpushed local audit rows at the front so the flush inserts
           exactly those (slice(0, queue)) instead of duplicating cloud rows */
        db.audit = local.audit.slice(0, auditQueue).concat(db.audit);
      }
      /* Fresh (empty) cloud with local data: keep the local working copy
         intact so the migration push uploads it instead of nothing. */
      if (lastCloudEmpty && localSnapshot &&
          ((localSnapshot.fgs || []).length + (localSnapshot.materials || []).length) > 0) {
        var keep = localSnapshot;
        localSnapshot = null;
        return keep;
      }
      localSnapshot = null;
      Store.hydrate(db);
      return db;
    });
  }

  /* ---------- profile ---------- */
  function ensureProfile() {
    var me = SB.me();
    if (!me || !me.uid) return Promise.resolve(null);
    return SB.selectAll("profiles", "id=eq." + me.uid).then(function (rows) {
      if (rows.length) { profile = rows[0]; return profile; }
      profile = {
        id: me.uid,
        full_name: me.email.split("@")[0],
        role: "PPIC",
        email: me.email
      };
      return SB.upsert("profiles", [profile]).then(function () { return profile; });
    });
  }
  function getProfile() { return profile; }
  function applyProfileUser() {
    if (!profile) return;
    Store.setUser({ name: profile.full_name || profile.email, email: profile.email, role: profile.role });
  }

  /* ---------- push: local -> cloud ---------- */
  function flushSoon() {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { flush(); }, 1200);
  }
  function flush() {
    if (!enabled() || status === "login" || status === "syncing") return Promise.resolve();
    if (!SB.me()) return Promise.resolve();
    if (!navigator.onLine) { setStatus("offline"); return Promise.resolve(); }
    if (!pendingCount()) { setStatus("cloud"); return Promise.resolve(); }
    setStatus("syncing");

    var db = Store.get();
    var marks = Object.keys(pending).map(function (k) { return pending[k]; });
    var doReplace = replaceAll;
    var queue = auditQueue;
    var chain = Promise.resolve();

    function group(table, op) {
      return marks.filter(function (m) { return m.table === table && m.op === op; }).map(function (m) { return m.key; });
    }
    function fgByIds(ids) { return db.fgs.filter(function (f) { return ids.indexOf(f.id) >= 0; }).map(fgRow); }
    function matByCodes(codes) { return db.materials.filter(function (m) { return codes.indexOf(m.code) >= 0; }).map(matRow); }

    if (doReplace) {
      /* PostgREST refuses DELETE without a WHERE clause, and wiping an
         already-empty cloud (first-sign-in migration) is pointless. */
      if (!lastCloudEmpty) {
        chain = chain
          .then(function () { return SB.remove("bom_lines", "id=not.is.null"); })
          .then(function () { return SB.remove("boms", "id=not.is.null"); })
          .then(function () { return SB.remove("fg_master", "id=not.is.null"); })
          .then(function () { return SB.remove("materials", "code=not.is.null"); })
          .then(function () { return SB.remove("sims", "id=not.is.null"); })
          .then(function () { return SB.remove("requests", "id=not.is.null"); })
          .then(function () { return SB.remove("meta_kv", "key=not.is.null"); });
      }
      chain = chain.then(function () { return pushEverything(db); });
    } else {
      var fgUp = group("fg_master", "upsert"), fgDel = group("fg_master", "delete");
      var matUp = group("materials", "upsert"), matDel = group("materials", "delete");
      var bomUp = group("boms", "upsert"), bomDel = group("boms", "delete");
      var simUp = group("sims", "upsert"), reqUp = group("requests", "upsert");

      if (fgDel.length) chain = chain.then(function () { return SB.remove("fg_master", "id=in.(" + fgDel.map(quote).join(",") + ")"); });
      if (fgUp.length) chain = chain.then(function () { return SB.upsert("fg_master", fgByIds(fgUp)); });
      if (matDel.length) chain = chain.then(function () { return SB.remove("materials", "code=in.(" + matDel.map(quote).join(",") + ")"); });
      if (matUp.length) chain = chain.then(function () { return SB.upsert("materials", matByCodes(matUp)); });
      if (bomDel.length) chain = chain
        .then(function () { return SB.remove("bom_lines", "bom_id=in.(" + bomDel.map(quote).join(",") + ")"); })
        .then(function () { return SB.remove("boms", "id=in.(" + bomDel.map(quote).join(",") + ")"); });
      if (bomUp.length) {
        chain = chain
          .then(function () { return SB.upsert("boms", db.boms.filter(function (b) { return bomUp.indexOf(b.id) >= 0; }).map(bomRow)); })
          .then(function () { return SB.remove("bom_lines", "bom_id=in.(" + bomUp.map(quote).join(",") + ")"); })
          .then(function () {
            var rows = [];
            db.boms.forEach(function (b) {
              if (bomUp.indexOf(b.id) < 0) return;
              b.items.forEach(function (it, i) { rows.push(lineRow(b.id, it, i)); });
            });
            return SB.insert("bom_lines", rows);
          });
      }
      if (simUp.length) chain = chain.then(function () {
        return SB.upsert("sims", db.sims.filter(function (s) { return simUp.indexOf(s.id) >= 0; })
          .map(function (s) { return { id: s.id, no_sim: s.noSim, payload: s }; }));
      });
      if (reqUp.length) chain = chain.then(function () {
        return SB.upsert("requests", db.requests.filter(function (r) { return reqUp.indexOf(r.id) >= 0; })
          .map(function (r) { return { id: r.id, type: r.type, no_doc: r.noDoc, payload: r }; }));
      });
    }

    if (queue > 0) {
      chain = chain.then(function () {
        var rows = db.audit.slice(0, queue).map(function (a) {
          return { ts: a.ts, user_name: a.user, role: a.role, action: a.action, entity: a.entity, detail: a.detail };
        }).reverse(); /* audit is newest-first locally; insert in chronological order */
        return SB.insert("audit_log", rows);
      });
    }
    chain = chain.then(function () {
      return SB.upsert("meta_kv", [{
        key: "app",
        value: { seq: db.meta.seq, expWarnDays: db.meta.expWarnDays, company: db.meta.company }
      }]);
    });

    return chain.then(function () {
      pending = {}; auditQueue = 0; replaceAll = false;
      savePending();
      setStatus("cloud");
    }).catch(function (err) {
      setStatus("offline");
      if (window.console) console.warn("Sync push failed:", err && err.message);
    });
  }
  function quote(s) { return '"' + String(s).replace(/"/g, '""') + '"'; }

  function pushEverything(db) {
    var lineRows = [];
    db.boms.forEach(function (b) { b.items.forEach(function (it, i) { lineRows.push(lineRow(b.id, it, i)); }); });
    return SB.upsert("fg_master", db.fgs.map(fgRow))
      .then(function () { return SB.upsert("materials", db.materials.map(matRow)); })
      .then(function () { return SB.upsert("boms", db.boms.map(bomRow)); })
      .then(function () { return SB.insert("bom_lines", lineRows); })
      .then(function () {
        return SB.upsert("sims", db.sims.map(function (s) { return { id: s.id, no_sim: s.noSim, payload: s }; }));
      })
      .then(function () {
        return SB.upsert("requests", db.requests.map(function (r) { return { id: r.id, type: r.type, no_doc: r.noDoc, payload: r }; }));
      });
  }

  /* ---------- lifecycle ---------- */
  function init(cb) {
    loadPending();
    if (!enabled()) { setStatus("local"); cb("local"); return; }
    SB.init(window.ASTORIA_SUPABASE.url, window.ASTORIA_SUPABASE.anonKey);
    if (!SB.restore()) { setStatus("login"); cb("login"); return; }
    localSnapshot = JSON.parse(JSON.stringify(Store.get()));
    localRowsBefore = (Store.get().fgs.length || 0) + (Store.get().materials.length || 0);
    bootFromCloud(cb);
  }
  function bootFromCloud(cb) {
    ensureProfile()
      .then(function () { applyProfileUser(); return hydrate(); })
      .then(function () {
        setStatus("cloud");
        cb("cloud");
        migrateIfFreshCloud();
        flush(); /* push anything queued while offline */
      })
      .catch(function (err) {
        if (window.console) console.warn("Cloud hydrate failed:", err && err.message);
        setStatus("offline");
        cb("offline"); /* run on local cache, retry later */
      });
  }
  function login(email, password, cb, errCb) {
    localSnapshot = JSON.parse(JSON.stringify(Store.get()));
    localRowsBefore = (Store.get().fgs.length || 0) + (Store.get().materials.length || 0);
    SB.signIn(email, password)
      .then(function () { return ensureProfile(); })
      .then(function () { applyProfileUser(); return hydrate(); })
      .then(function () {
        setStatus("cloud");
        cb();
        migrateIfFreshCloud();
        flush();
      })
      .catch(function (err) { errCb(err && err.message ? err.message : String(err)); });
  }
  /* First sign-in on an empty cloud: upload the local working copy
     once, so existing masters / CSV imports migrate to Supabase. */
  function migrateIfFreshCloud() {
    if (lastCloudEmpty && localRowsBefore > 0) {
      replaceAll = true;
      savePending();
    }
  }
  function signOut() { return SB.signOut(); }

  window.addEventListener("online", function () { if (enabled() && SB.me()) flush(); });

  return {
    enabled: enabled, init: init, login: login, signOut: signOut,
    getStatus: getStatus, onChange: onChange, pendingCount: pendingCount,
    mark: mark, markAudit: markAudit, markAll: markAll,
    flush: flush, flushSoon: flushSoon, hydrate: hydrate,
    getProfile: getProfile, applyProfileUser: applyProfileUser
  };
})();
