/* ============================================================
   STORE - persistence (browser localStorage), audit trail,
   document sequences, import / export
   ============================================================ */
window.Store = (function () {

  var KEY = "astoria_fg_suite_v1";
  var db = null;
  /* document sequences used across the pipeline (FR-xx numbering) */
  var SEQ_KEYS = ["bom", "mr", "pr", "sim", "so", "po", "rcv", "wo", "btip", "qc", "sj", "calloff", "campaign", "staging", "wop", "lc", "ipc", "rel"];
  function fixSeq() {
    db.meta.seq = db.meta.seq || {};
    SEQ_KEYS.forEach(function (k) { if (db.meta.seq[k] == null) db.meta.seq[k] = 0; });
  }
  function fixArrays() {
    db.customers = db.customers || [];
    db.formulas = db.formulas || [];
    db.packagings = db.packagings || [];
    db.mixers = db.mixers || [];
    db.salesOrders = db.salesOrders || [];
    db.purchaseReqs = db.purchaseReqs || [];
    db.calloffs = db.calloffs || [];
    db.workOrdersBulk = db.workOrdersBulk || [];
    db.purchaseOrders = db.purchaseOrders || [];
    db.inventoryLots = db.inventoryLots || [];
    db.inventoryTxns = db.inventoryTxns || [];
    db.stagings = db.stagings || [];
    db.lineClearances = db.lineClearances || [];
    db.ipcRecords = db.ipcRecords || [];
    db.woBulkPhases = db.woBulkPhases || [];
    db.btipTransfers = db.btipTransfers || [];
    db.workOrdersPack = db.workOrdersPack || [];
    db.releases = db.releases || [];
    db.sims = db.sims || [];
    db.requests = db.requests || [];
    db.audit = db.audit || [];
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : Seed.build();
      if (!db || !db.meta || !Array.isArray(db.fgs)) db = Seed.build();
    } catch (e) {
      db = Seed.build();
    }
    fixSeq();
    db.meta.user = db.meta.user || { name: "User", email: "", role: "PPIC" };
    fixArrays();
    refreshDerived();
    return db;
  }
  function get() { return db; }
  function save() {
    localStorage.setItem(KEY, JSON.stringify(db));
    if (window.Sync && Sync.enabled()) Sync.flushSoon();
  }
  /* Cloud hydrate: replace the working copy without marking dirty */
  function hydrate(next) {
    db = next;
    fixSeq();
    db.meta.user = db.meta.user || { name: "User", email: "", role: "PPIC" };
    fixArrays();
    refreshDerived();
    localStorage.setItem(KEY, JSON.stringify(db));
  }
  function setUser(u) { db.meta.user = u; }

  /* Recompute Column A (Kode FG) & Column C (Status) like the Apps Script */
  function refreshDerived() {
    db.fgs.forEach(function (f) {
      f.kodeFG = Engine.kodeFG(f.ffs, f.fps);
      f.status = Engine.evaluateStatus(f.ffs, f.fps, f.kodeNA, f.tglExpire, f.discontinue);
    });
  }

  /* ---------- Regulatory gate: boot-time NA expiry auditor ----------
     Recomputes every F/G status from its BPOM (NA) expiry date once per
     day and writes an audit entry whenever a SKU lapses Aktif -> Non Aktif.
     The dashboard watchlist reads the same statuses, so it reflects the flip
     on the very next render. The per-day baseline lives in db.meta (local
     only, carried across cloud hydrate by sync.js) and the run is gated by a
     WIB calendar-day key so repeated boots on the same day never spam. */
  function runExpiryAudit() {
    var today = Engine.todayISO();
    db.meta.lastExpiryAudit = db.meta.lastExpiryAudit || "";
    db.meta.fgStatus = db.meta.fgStatus || {};
    if (db.meta.lastExpiryAudit === today) return 0;   /* already audited today */

    var todayMs = Engine.parseDate(today).getTime();
    var prev = db.meta.fgStatus, alive = {}, flips = 0;
    db.fgs.forEach(function (f) {
      alive[f.id] = 1;
      var next = Engine.evaluateStatus(f.ffs, f.fps, f.kodeNA, f.tglExpire, f.discontinue);
      f.status = next;                                  /* keep working copy fresh */
      var before = prev[f.id];
      prev[f.id] = next;
      /* Only an expiry-driven Aktif -> Non Aktif lapse is a regulatory flip;
         a manual discontinue already carries its own audit entry. */
      if (before !== "Aktif" || next !== "Non Aktif" || f.discontinue) return;
      var d = Engine.parseDate(f.tglExpire);
      if (!d || d.getTime() >= todayMs) return;
      var head = f.kodeFG + " (";
      var dup = db.audit.some(function (a) {
        return a.action === "EXPIRE" && a.entity === "Master F/G" &&
          a.ts && a.ts.slice(0, 10) === today && String(a.detail).indexOf(head) === 0;
      });
      if (dup) return;
      db.audit.unshift({
        ts: Engine.nowWIB(), user: "system", role: "Regulatory gate",
        action: "EXPIRE", entity: "Master F/G",
        detail: head + f.deskripsi + ") - NA " + (f.kodeNA || "-") + " expired " +
          Engine.toISO(f.tglExpire) + "; status Aktif \u2192 Non Aktif (auto)"
      });
      flips++;
      if (window.Sync && Sync.enabled()) Sync.markAudit();
    });
    /* prune snapshot rows for deleted SKUs so it cannot grow unbounded */
    Object.keys(prev).forEach(function (id) { if (!alive[id]) delete prev[id]; });
    if (db.audit.length > 1000) db.audit.length = 1000;
    db.meta.lastExpiryAudit = today;
    save();
    return flips;
  }

  function audit(action, entity, detail) {
    db.audit.unshift({
      ts: Engine.nowWIB(),
      user: db.meta.user.email || db.meta.user.name,
      role: db.meta.user.role,
      action: action,
      entity: entity,
      detail: detail || ""
    });
    if (db.audit.length > 1000) db.audit.length = 1000;
    if (window.Sync && Sync.enabled()) Sync.markAudit();
  }

  function nextSeq(key) {
    db.meta.seq[key] = (db.meta.seq[key] || 0) + 1;
    return db.meta.seq[key];
  }

  function uid(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase() +
      Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0");
  }

  /* ---------- lookups ---------- */
  function matMap() {
    var m = {};
    db.materials.forEach(function (x) { m[x.code] = x; });
    return m;
  }
  function fgById(id) { return db.fgs.filter(function (f) { return f.id === id; })[0] || null; }
  function bomByFg(fgId) {
    return db.boms.filter(function (b) { return b.fgId === fgId; })
      .sort(function (a, b) { return b.revision - a.revision; })[0] || null;
  }

  /* ---------- Master F/G CRUD ---------- */
  /* Editors hand us a COPY of the row, so every save must write that copy
     back into the working copy: replace the original (found by oldKey,
     which differs from rec's key when a primary key was edited) or insert. */
  function replaceRow(arr, keyField, oldKey, rec, atEnd) {
    for (var i = 0; i < arr.length; i++) {
      if (String(arr[i][keyField]) === String(oldKey)) { arr[i] = rec; return; }
    }
    if (atEnd) arr.push(rec); else arr.unshift(rec);
  }
  function saveFG(rec, isNew, oldId) {
    rec.kodeFG = Engine.kodeFG(rec.ffs, rec.fps);
    rec.status = Engine.evaluateStatus(rec.ffs, rec.fps, rec.kodeNA, rec.tglExpire, rec.discontinue);
    rec.diubahOleh = db.meta.user.email || db.meta.user.name;
    rec.waktuUpdate = Engine.nowWIB();
    replaceRow(db.fgs, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Master F/G",
      rec.kodeFG + " (" + rec.deskripsi + ") - status " + rec.status);
    if (window.Sync) {
      if (!isNew && oldId && oldId !== rec.id) Sync.mark("fg_master", oldId, "delete");
      Sync.mark("fg_master", rec.id);
    }
    save();
    return rec;
  }
  function deleteFG(id) {
    var f = fgById(id);
    db.fgs = db.fgs.filter(function (x) { return x.id !== id; });
    if (f) audit("DELETE", "Master F/G", f.kodeFG + " (" + f.deskripsi + ")");
    if (window.Sync) Sync.mark("fg_master", id, "delete");
    save();
  }
  /* Revision workflow: formula / kemas code revised for the same product.
     The old SKU is superseded (Discontinue -> status Non Aktif) and a new
     SKU is created carrying the same deskripsi but WITHOUT Kode NA /
     Tgl Expire NA (BPOM recertification required) -> status Pending BPOM. */
  function reviseFG(oldId, newFfs, newFps) {
    var old = fgById(oldId);
    if (!old) return null;
    var rec = JSON.parse(JSON.stringify(old));
    rec.ffs = newFfs; rec.fps = newFps;
    rec.id = newFfs + "|" + newFps;
    rec.kodeNA = ""; rec.tglExpire = ""; rec.discontinue = false;
    old.discontinue = true;
    saveFG(old, false, oldId);
    saveFG(rec, true, null);
    audit("REVISION", "Master F/G",
      old.kodeFG + " superseded by " + rec.kodeFG + " (" + rec.deskripsi + ") - NA cleared for BPOM recertification");
    save();
    return rec;
  }

  /* ---------- Master Material CRUD ---------- */
  function saveMaterial(rec, isNew, oldCode) {
    replaceRow(db.materials, "code", oldCode || rec.code, rec, true);
    audit(isNew ? "CREATE" : "UPDATE", "Master Material", rec.code + " " + rec.name +
      " (stock " + Engine.fmtNum(rec.stockQty) + " " + rec.unit + ")");
    if (window.Sync) {
      if (!isNew && oldCode && oldCode !== rec.code) Sync.mark("materials", oldCode, "delete");
      Sync.mark("materials", rec.code);
    }
    save();
    return rec;
  }
  function deleteMaterial(code) {
    var used = db.boms.some(function (b) {
      return b.items.some(function (it) { return it.materialCode === code; });
    });
    if (used) return false;
    var m = matMap()[code];
    db.materials = db.materials.filter(function (x) { return x.code !== code; });
    if (m) audit("DELETE", "Master Material", code + " " + m.name);
    if (window.Sync) Sync.mark("materials", code, "delete");
    save();
    return true;
  }

  /* ---------- pipeline master CRUD (customer / formula / packaging / mixer) ----------
     One generic write-back helper; each master only supplies its cloud
     table, store array, key and audit wording. */
  var MASTER_CFG = {
    customer: { table: "m_customer", store: "customers", key: "id", label: "Master Customer",
      describe: function (c) { return c.id + " " + (c.name || ""); } },
    formula: { table: "m_formula", store: "formulas", key: "id", label: "Master Formula (FFS)",
      describe: function (f) { return f.id + " kategori " + (f.kategori || "-") + " BJ " + (f.bj || 1); } },
    packaging: { table: "m_packaging", store: "packagings", key: "id", label: "Master Packaging (FPS)",
      describe: function (p) { return p.id + " rev " + (p.revisi || 0); } },
    mixer: { table: "m_mixer", store: "mixers", key: "id", label: "Mixer catalogue",
      describe: function (m) { return m.id + " " + (m.name || "") + " " + (m.capacityKg || 0) + " kg"; } }
  };
  function saveMaster(which, rec, isNew, oldId) {
    var cfg = MASTER_CFG[which];
    replaceRow(db[cfg.store], cfg.key, oldId || rec[cfg.key], rec, true);
    audit(isNew ? "CREATE" : "UPDATE", cfg.label, cfg.describe(rec));
    if (window.Sync) {
      if (!isNew && oldId && oldId !== rec[cfg.key]) Sync.mark(cfg.table, oldId, "delete");
      Sync.mark(cfg.table, rec[cfg.key]);
    }
    save();
    return rec;
  }
  function deleteMaster(which, id) {
    var cfg = MASTER_CFG[which];
    var rec = db[cfg.store].filter(function (x) { return String(x[cfg.key]) === String(id); })[0];
    db[cfg.store] = db[cfg.store].filter(function (x) { return String(x[cfg.key]) !== String(id); });
    if (rec) audit("DELETE", cfg.label, cfg.describe(rec));
    if (window.Sync) Sync.mark(cfg.table, id, "delete");
    save();
  }
  function masterById(which, id) {
    var cfg = MASTER_CFG[which];
    return db[cfg.store].filter(function (x) { return String(x[cfg.key]) === String(id); })[0] || null;
  }
  function saveCustomer(rec, isNew, oldId) { return saveMaster("customer", rec, isNew, oldId); }
  function saveFormula(rec, isNew, oldId) { return saveMaster("formula", rec, isNew, oldId); }
  function savePackaging(rec, isNew, oldId) { return saveMaster("packaging", rec, isNew, oldId); }
  function saveMixer(rec, isNew, oldId) { return saveMaster("mixer", rec, isNew, oldId); }
  function deleteCustomer(id) { deleteMaster("customer", id); }
  function deleteFormula(id) { deleteMaster("formula", id); }
  function deletePackaging(id) { deleteMaster("packaging", id); }
  function deleteMixer(id) { deleteMaster("mixer", id); }
  function customerById(id) { return masterById("customer", id); }
  function formulaById(id) { return masterById("formula", id); }
  function packagingById(id) { return masterById("packaging", id); }
  function mixerById(id) { return masterById("mixer", id); }

  /* ---------- BOM CRUD ---------- */
  function saveBOM(rec, isNew) {
    replaceRow(db.boms, "id", rec.id, rec, false);
    var fg = fgById(rec.fgId);
    audit(isNew ? "CREATE" : "UPDATE", "Bill of Material",
      rec.noBom + " rev " + rec.revision + " for " + (fg ? fg.kodeFG : rec.fgId) +
      " [" + rec.status + "] " + rec.items.length + " lines");
    if (window.Sync) Sync.mark("boms", rec.id);
    save();
    return rec;
  }
  function deleteBOM(id) {
    var b = db.boms.filter(function (x) { return x.id === id; })[0];
    db.boms = db.boms.filter(function (x) { return x.id !== id; });
    if (b) audit("DELETE", "Bill of Material", b.noBom);
    if (window.Sync) Sync.mark("boms", id, "delete");
    save();
  }

  /* ---------- Sales Order CRUD (FR-MK-03) ----------
     Marketing creates a Draft; Confirm locks the commercial fields and
     Close is signed by PPIC once the demand is fulfilled. The status
     machine itself lives in rbac.js (salesOrder) so the UI, this store
     and the Phase 6 RLS policies all read the same transitions. */
  function soById(id) {
    return db.salesOrders.filter(function (x) { return String(x.id) === String(id); })[0] || null;
  }
  function saveSalesOrder(rec, isNew, oldId) {
    replaceRow(db.salesOrders, "id", oldId || rec.id, rec, false);
    var fg = fgById(rec.fgId);
    audit(isNew ? "CREATE" : "UPDATE", "Sales Order",
      rec.noSo + " - " + (fg ? fg.kodeFG : rec.fgId) + " x " + Engine.fmtNum(rec.orderQty, 0) +
      " pcs, delivery " + (rec.deliveryDate || "-") + " [" + rec.status + "]");
    if (window.Sync) {
      if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_sales_order", oldId, "delete");
      Sync.mark("t_sales_order", rec.id);
    }
    save();
    return rec;
  }
  /* Status transition re-validated against the rbac.js state machine (the
     view only renders the allowed hops; this is the second line of defence). */
  function transitionSO(id, to) {
    var so = soById(id);
    if (!so) return false;
    var ok = window.RBAC ? RBAC.canTransition("salesOrder", so.status, to) : false;
    if (!ok) {
      audit("DENY", "Sales Order", so.noSo + " - " + so.status + " \u2192 " + to +
        " not allowed for " + (db.meta.user.role || "role"));
      save();
      return false;
    }
    var from = so.status;
    so.status = to;
    audit("TRANSITION", "Sales Order", so.noSo + " - " + from + " \u2192 " + to);
    if (window.Sync) Sync.mark("t_sales_order", so.id);
    save();
    return true;
  }
  function deleteSalesOrder(id) {
    var so = soById(id);
    db.salesOrders = db.salesOrders.filter(function (x) { return String(x.id) !== String(id); });
    if (so) audit("DELETE", "Sales Order", so.noSo);
    if (window.Sync) Sync.mark("t_sales_order", id, "delete");
    save();
  }

  /* ---------- PPIC netting output (FR-PP-11 + call-off + campaign WO) ----------
     One PPIC "run" against a sales order writes three linked row sets:
     purchase requisition lines (Astoria shortfalls, MOQ-rounded), call-off
     lines (customer-supplied components) and the mixer-sized bulk batches
     that form the parent campaign work order. Re-running an order supersedes
     the previous Open/Planned rows for the same SO so a re-plan never leaves
     stale duplicates; rows already progressed are left untouched. */
  function savePpicRun(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var soId = inp.soId || "";

    /* supersede a previous still-open plan for the same SO */
    var purged = 0;
    if (soId) {
      db.purchaseReqs = db.purchaseReqs.filter(function (r) {
        if (r.soId === soId && r.status === "Open") { if (window.Sync) Sync.mark("t_purchase_req", r.id, "delete"); purged++; return false; }
        return true;
      });
      db.calloffs = db.calloffs.filter(function (r) {
        if (r.soId === soId && r.status === "Open") { if (window.Sync) Sync.mark("t_calloff", r.id, "delete"); purged++; return false; }
        return true;
      });
      db.workOrdersBulk = db.workOrdersBulk.filter(function (r) {
        if (r.soId === soId && r.status === "Planned") { if (window.Sync) Sync.mark("t_work_order_bulk", r.id, "delete"); purged++; return false; }
        return true;
      });
    }

    var mm = matMap();
    var reqNo = "", callOffNo = "", campaignNo = "";
    var prCount = 0, coCount = 0, woCount = 0;

    (inp.prLines || []).forEach(function (l) {
      if (!reqNo) reqNo = Engine.noRequest("PR", nextSeq("pr"), date);
      var m = mm[l.materialCode] || {};
      var rec = {
        id: uid("PR"), reqNo: reqNo, soId: soId, fgId: inp.fgId || "",
        materialCode: l.materialCode, materialName: l.name || m.name || "",
        qty: l.orderQty, netQty: l.net, unit: l.unit || m.unit || "", moq: l.moq || 0,
        supplier: m.supplier || "", requiredBy: l.requiredBy || "", status: "Open"
      };
      db.purchaseReqs.unshift(rec);
      if (window.Sync) Sync.mark("t_purchase_req", rec.id);
      prCount++;
    });

    (inp.calloffLines || []).forEach(function (l) {
      if (!callOffNo) callOffNo = "CO/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("calloff"), 3);
      var rec = {
        id: uid("CO"), callOffNo: callOffNo, soId: soId, fgId: inp.fgId || "",
        customerId: inp.customerId || "", materialCode: l.materialCode, materialName: l.name || "",
        qty: l.qty, unit: l.unit || "", requiredBy: l.requiredBy || "", status: "Open"
      };
      db.calloffs.unshift(rec);
      if (window.Sync) Sync.mark("t_calloff", rec.id);
      coCount++;
    });

    (inp.batches || []).forEach(function (b, i) {
      if (!campaignNo) campaignNo = "CAMP/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("campaign"), 3);
      var rec = {
        id: uid("WO"), woNo: Engine.noRequest("WO", nextSeq("wo"), date), campaignNo: campaignNo,
        soId: soId, fgId: inp.fgId || "", bulkCode: inp.bulkCode || "",
        mixerId: b.mixerId || "", batchSeq: i + 1, plannedKg: b.plannedKg || 0, status: "Planned"
      };
      db.workOrdersBulk.unshift(rec);
      if (window.Sync) Sync.mark("t_work_order_bulk", rec.id);
      woCount++;
    });

    var fg = fgById(inp.fgId);
    audit("CREATE", "PPIC Netting",
      (inp.noSo ? inp.noSo + " - " : "") + (fg ? fg.kodeFG : inp.fgId) +
      ": " + prCount + " PR line(s)" + (reqNo ? " [" + reqNo + "]" : "") +
      ", " + coCount + " call-off(s)" + (callOffNo ? " [" + callOffNo + "]" : "") +
      ", " + woCount + " bulk batch(es)" + (campaignNo ? " [" + campaignNo + "]" : "") +
      (purged ? "; superseded " + purged + " prior row(s)" : ""));
    save();
    return { reqNo: reqNo, callOffNo: callOffNo, campaignNo: campaignNo,
      prCount: prCount, calloffCount: coCount, woCount: woCount, purged: purged };
  }

  /* ============================================================
     PHASE 3 - purchasing, warehouse inbound & the stock ledger
     ============================================================ */

  /* ---------- stock ledger (append-only) ----------
     materials.stock_qty is the running cache; every posting keeps it in
     step so reads stay O(1). The opening balance (stock that predates the
     ledger) is derived, never stored: opening = cache - sum(ledger qty).
     Signed qty: RECEIPT / ADJUST-up positive, ISSUE negative. */
  function txnById(id) { return db.inventoryTxns.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function netLedger(code) {
    return db.inventoryTxns.reduce(function (a, t) {
      return t.materialCode === code ? a + (Number(t.qty) || 0) : a;
    }, 0);
  }
  function sohOf(code) { var m = matMap()[code]; return m ? Number(m.stockQty) || 0 : 0; }
  function openingOf(code) { return Engine.round4(sohOf(code) - netLedger(code)); }
  function allocatedOf(code) {
    return db.stagings.reduce(function (a, s) {
      return (s.status === "Reserved" && s.materialCode === code) ? a + (Number(s.qty) || 0) : a;
    }, 0);
  }
  function availableOf(code) { return Math.max(0, Engine.round4(sohOf(code) - allocatedOf(code))); }
  /* Chronological ledger for one material with a running balance (Kartu Stock). */
  function ledgerFor(code) {
    var rows = db.inventoryTxns.filter(function (t) { return t.materialCode === code; })
      .slice().sort(function (a, b) {
        var d = String(a.txnAt || "").localeCompare(String(b.txnAt || ""));
        return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
      });
    var bal = openingOf(code);
    return rows.map(function (t) { bal = Engine.round4(bal + (Number(t.qty) || 0)); return { txn: t, balance: bal }; });
  }
  function postTxn(t) {
    var m = matMap()[t.materialCode] || null;
    var rec = {
      id: t.id || uid("TXN"), txnType: t.txnType || "ADJUST",
      materialCode: t.materialCode || "", materialName: t.materialName || (m ? m.name : "") || "",
      lotId: t.lotId || "", woId: t.woId || "",
      qty: Number(t.qty) || 0, uom: t.uom || (m ? m.unit : "") || "",
      refType: t.refType || "", refId: t.refId || "", note: t.note || "",
      txnAt: t.txnAt || Engine.nowWIB()
    };
    db.inventoryTxns.unshift(rec);
    if (m) m.stockQty = Engine.round4((Number(m.stockQty) || 0) + rec.qty);
    if (window.Sync) { Sync.mark("t_inventory_txn", rec.id); if (m) Sync.mark("materials", m.code); }
    return rec;
  }

  /* ---------- purchase order (FR-PP-14) ---------- */
  function poById(id) { return db.purchaseOrders.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  /* Raise one PO from a set of Open PR lines (normally a single supplier). */
  function createPoFromPr(prIds, opts) {
    opts = opts || {};
    var date = opts.date || Engine.todayISO();
    var mm = matMap();
    var poNo = Engine.noRequest("PO", nextSeq("po"), date);
    var count = 0;
    (prIds || []).forEach(function (pid) {
      var pr = db.purchaseReqs.filter(function (r) { return String(r.id) === String(pid); })[0];
      if (!pr) return;
      var m = mm[pr.materialCode] || {};
      var rec = {
        id: uid("PO"), poNo: poNo, prId: pr.id,
        supplier: opts.supplier || pr.supplier || m.supplier || "",
        materialCode: pr.materialCode, materialName: pr.materialName || m.name || "",
        qty: Number(pr.qty) || 0, receivedQty: 0,
        unitPrice: Number((opts.prices || {})[pr.id]) || 0,
        unit: pr.unit || m.unit || "",
        leadDays: Number(opts.leadDays != null ? opts.leadDays : (m.leadDays || 0)) || 0,
        eta: opts.eta || "", status: "Open", note: opts.note || ""
      };
      db.purchaseOrders.unshift(rec);
      if (window.Sync) Sync.mark("t_purchase_order", rec.id);
      if (pr.status === "Open") { pr.status = "Ordered"; if (window.Sync) Sync.mark("t_purchase_req", pr.id); }
      count++;
    });
    audit("CREATE", "Purchase Order", poNo + " - " + count + " line(s)" + (opts.supplier ? " from " + opts.supplier : ""));
    save();
    return { poNo: poNo, count: count };
  }
  function savePurchaseOrder(rec, isNew, oldId) {
    replaceRow(db.purchaseOrders, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Purchase Order", rec.poNo + " - " + rec.materialCode + " x " + Engine.fmtNum(rec.qty, 2) + " [" + rec.status + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_purchase_order", oldId, "delete"); Sync.mark("t_purchase_order", rec.id); }
    save(); return rec;
  }
  /* Receive (part of) a PO line: creates a Quarantine lot + a RECEIPT txn. */
  function receivePoLine(poId, data) {
    var po = poById(poId); if (!po) return null;
    data = data || {};
    var qty = Number(data.qty) || 0;
    if (qty <= 0) return null;
    var mm = matMap()[po.materialCode] || {};
    var lot = {
      id: uid("LOT"), lotNo: data.lotNo || "", materialCode: po.materialCode,
      materialName: po.materialName || mm.name || "", poId: po.id,
      qty: qty, qtyReceived: qty, uom: po.unit || mm.unit || "",
      receivedAt: data.receivedAt || Engine.todayISO(),
      coaRef: data.coaRef || "", halalRef: data.halalRef || "", msdsRef: data.msdsRef || "",
      expiry: data.expiry || "", status: "Quarantine", note: data.note || ""
    };
    db.inventoryLots.unshift(lot);
    if (window.Sync) Sync.mark("t_inventory_lot", lot.id);
    postTxn({ txnType: "RECEIPT", materialCode: po.materialCode, materialName: lot.materialName,
      lotId: lot.id, qty: qty, uom: lot.uom, refType: "PO", refId: po.id,
      note: "Receipt " + po.poNo + (lot.lotNo ? " lot " + lot.lotNo : "") });
    po.receivedQty = Engine.round4((Number(po.receivedQty) || 0) + qty);
    po.status = po.receivedQty >= (Number(po.qty) || 0) ? "Closed" : "Partial";
    if (window.Sync) Sync.mark("t_purchase_order", po.id);
    audit("RECEIPT", "Inventory Lot", po.materialCode + " + " + Engine.fmtNum(qty, 2) + " " + lot.uom +
      " (" + (lot.lotNo || "no lot") + ") against " + po.poNo + " - Quarantine");
    save();
    return lot;
  }

  /* ---------- inventory lot + QA release gate ---------- */
  function lotById(id) { return db.inventoryLots.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function saveLot(rec, isNew, oldId) {
    replaceRow(db.inventoryLots, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Inventory Lot", (rec.lotNo || rec.id) + " " + rec.materialCode + " [" + rec.status + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_inventory_lot", oldId, "delete"); Sync.mark("t_inventory_lot", rec.id); }
    save(); return rec;
  }
  /* QA disposition. Reject pulls the lot out of stock via an ADJUST. */
  function setLotStatus(id, status) {
    var lot = lotById(id); if (!lot) return false;
    var ok = window.RBAC ? RBAC.canTransition("lot", lot.status, status) : false;
    if (!ok) { audit("DENY", "Inventory Lot", (lot.lotNo || id) + " - " + lot.status + " \u2192 " + status + " not allowed"); save(); return false; }
    var from = lot.status; lot.status = status;
    if (status === "Rejected" && (Number(lot.qty) || 0) > 0) {
      postTxn({ txnType: "ADJUST", materialCode: lot.materialCode, materialName: lot.materialName,
        lotId: lot.id, qty: -(Number(lot.qty) || 0), uom: lot.uom, refType: "QA", refId: lot.id,
        note: "QA rejected lot " + (lot.lotNo || id) });
      lot.qty = 0;
    }
    audit("TRANSITION", "Inventory Lot", (lot.lotNo || id) + " " + lot.materialCode + " - " + from + " \u2192 " + status);
    if (window.Sync) Sync.mark("t_inventory_lot", lot.id);
    save(); return true;
  }
  function reservedOnLot(lotId) {
    return db.stagings.reduce(function (a, s) {
      return (s.status === "Reserved" && String(s.lotId) === String(lotId)) ? a + (Number(s.qty) || 0) : a;
    }, 0);
  }
  /* Released lots with free stock, oldest first (FIFO picking). */
  function releasedLots(code) {
    return db.inventoryLots.filter(function (l) {
      return l.materialCode === code && l.status === "Released" && (Number(l.qty) || 0) > 0;
    }).sort(function (a, b) {
      var d = String(a.receivedAt || "").localeCompare(String(b.receivedAt || ""));
      return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
    });
  }
  /* Greedy FIFO allocation of `qty` across Released lots (net of reservations). */
  function fifoPick(code, qty) {
    var need = Number(qty) || 0, picks = [];
    if (need > 0) {
      releasedLots(code).forEach(function (l) {
        if (need <= 0) return;
        var free = Math.max(0, Engine.round4((Number(l.qty) || 0) - reservedOnLot(l.id)));
        var take = Math.min(need, free);
        if (take > 0) {
          picks.push({ lotId: l.id, lotNo: l.lotNo, materialCode: code, materialName: l.materialName, qty: Engine.round4(take), uom: l.uom });
          need = Engine.round4(need - take);
        }
      });
    }
    return { picks: picks, short: Engine.round4(Math.max(0, need)) };
  }

  /* ---------- staging pick lists (FR-PP-01 / FR-PP-04 / FR-PP-10) ---------- */
  function stagingById(id) { return db.stagings.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function createStaging(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var stagingNo = "STG/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("staging"), 3);
    var count = 0;
    (inp.picks || []).forEach(function (p) {
      var m = matMap()[p.materialCode] || {};
      var lot = lotById(p.lotId);
      var rec = {
        id: uid("STG"), stagingNo: stagingNo, docType: inp.docType || "FR-PP-01",
        woId: inp.woId || "", campaignNo: inp.campaignNo || "", fgId: inp.fgId || "",
        materialCode: p.materialCode, materialName: p.materialName || m.name || (lot ? lot.materialName : "") || "",
        lotId: p.lotId || "", lotNo: p.lotNo || (lot ? lot.lotNo : "") || "",
        qty: Number(p.qty) || 0, uom: p.uom || m.unit || "",
        status: "Reserved", weighedBy: "", weighedAt: "", note: p.note || ""
      };
      db.stagings.unshift(rec);
      if (window.Sync) Sync.mark("t_staging", rec.id);
      count++;
    });
    audit("CREATE", "Staging", stagingNo + " (" + (inp.docType || "FR-PP-01") + ") - " + count + " line(s)" + (inp.campaignNo ? " for " + inp.campaignNo : ""));
    save();
    return { stagingNo: stagingNo, count: count };
  }
  /* Dispense one staged line: post the ISSUE and decrement the lot. */
  function dispenseStaging(id, weighedBy) {
    var s = stagingById(id); if (!s || s.status !== "Reserved") return false;
    s.status = "Dispensed";
    s.weighedBy = weighedBy || db.meta.user.email || db.meta.user.name || "";
    s.weighedAt = Engine.nowWIB();
    var lot = lotById(s.lotId);
    if (lot) { lot.qty = Engine.round4(Math.max(0, (Number(lot.qty) || 0) - (Number(s.qty) || 0))); if (window.Sync) Sync.mark("t_inventory_lot", lot.id); }
    postTxn({ txnType: "ISSUE", materialCode: s.materialCode, materialName: s.materialName,
      lotId: s.lotId, woId: s.woId, qty: -(Number(s.qty) || 0), uom: s.uom,
      refType: "STAGING", refId: s.id, note: "Staging " + s.stagingNo + (s.lotNo ? " lot " + s.lotNo : "") });
    if (window.Sync) Sync.mark("t_staging", s.id);
    audit("ISSUE", "Staging", s.materialCode + " - " + Engine.fmtNum(s.qty, 2) + " " + s.uom + " dispensed from " + s.stagingNo);
    save(); return true;
  }
  function cancelStaging(id) {
    var s = stagingById(id); if (!s || s.status !== "Reserved") return false;
    s.status = "Cancelled";
    if (window.Sync) Sync.mark("t_staging", s.id);
    audit("CANCEL", "Staging", s.stagingNo + " " + s.materialCode + " reservation cancelled");
    save(); return true;
  }

  /* ============================================================
     PHASE 4 - QA/QC gates + production execution
     ============================================================ */

  /* ---------- line clearance (FR-QA-21/22/23) ----------
     A QC-signed checklist that gates the next operation: FR-QA-21 gates
     bulk mixing, FR-QA-22 gates packing, FR-QA-23 gates inkjet batch/ED.
     The matching clearance must be Passed before the WO may start. */
  function lcById(id) { return db.lineClearances.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function clearancesFor(woId) { return db.lineClearances.filter(function (c) { return String(c.woId) === String(woId); }); }
  function clearancePassed(woId, type) {
    return db.lineClearances.some(function (c) {
      return String(c.woId) === String(woId) && c.clearanceType === type && c.status === "Passed";
    });
  }
  function createLineClearance(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var rec = {
      id: uid("LC"), clearanceNo: "LC/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("lc"), 3),
      clearanceType: inp.clearanceType || "FR-QA-21", woType: inp.woType || "Bulk",
      woId: inp.woId || "", woRef: inp.woRef || "", campaignNo: inp.campaignNo || "",
      checklist: inp.checklist || [], status: "Open", qcSigner: "", qcTime: "", note: inp.note || ""
    };
    db.lineClearances.unshift(rec);
    if (window.Sync) Sync.mark("t_line_clearance", rec.id);
    audit("CREATE", "Line Clearance", rec.clearanceNo + " " + rec.clearanceType + " for " + (rec.woRef || rec.woId));
    save(); return rec;
  }
  function saveLineClearance(rec, isNew, oldId) {
    replaceRow(db.lineClearances, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Line Clearance", rec.clearanceNo + " " + rec.clearanceType + " [" + rec.status + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_line_clearance", oldId, "delete"); Sync.mark("t_line_clearance", rec.id); }
    save(); return rec;
  }
  function setClearanceStatus(id, status) {
    var lc = lcById(id); if (!lc) return false;
    var ok = window.RBAC ? RBAC.canTransition("lineClearance", lc.status, status) : false;
    if (!ok) { audit("DENY", "Line Clearance", lc.clearanceNo + " - " + lc.status + " \u2192 " + status + " not allowed"); save(); return false; }
    var from = lc.status; lc.status = status;
    if (status !== "Open") { lc.qcSigner = db.meta.user.email || db.meta.user.name; lc.qcTime = Engine.nowWIB(); }
    audit("TRANSITION", "Line Clearance", lc.clearanceNo + " " + lc.clearanceType + " - " + from + " \u2192 " + status);
    if (window.Sync) Sync.mark("t_line_clearance", lc.id);
    save(); return true;
  }

  /* ---------- IPC record (FR-QA-25 / FR-QC-05 / process) ----------
     Checkpoints validated against limits on the formula/packaging
     masters, resolved through the FG's production BOM. */
  function ipcById(id) { return db.ipcRecords.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function ipcLimit(fgId, param) {
    var bom = fgId ? bomByFg(fgId) : null; if (!bom) return null;
    if (param === "ph") {
      var fm = bom.formulaId ? formulaById(bom.formulaId) : null; if (!fm) return null;
      var lo = (fm.phMin === "" || fm.phMin == null) ? null : Number(fm.phMin);
      var hi = (fm.phMax === "" || fm.phMax == null) ? null : Number(fm.phMax);
      return (lo == null && hi == null) ? null : { min: lo, max: hi, unit: "pH" };
    }
    if (param === "fill" || param === "weight") {
      var pk = bom.packagingId ? packagingById(bom.packagingId) : null; if (!pk) return null;
      return { min: Number(pk.fillMin) || 0, max: Number(pk.fillMax) || 0, unit: "ml" };
    }
    return null;
  }
  function checkPass(c) {
    var v = Number(c.value);
    if (isNaN(v)) return c.pass !== false;
    if (c.min != null && c.min !== "" && v < Number(c.min)) return false;
    if (c.max != null && c.max !== "" && v > Number(c.max)) return false;
    return true;
  }
  function saveIpcRecord(rec, isNew, oldId) {
    (rec.checks || []).forEach(function (c) { c.pass = checkPass(c); });
    rec.result = (rec.checks || []).some(function (c) { return c.pass === false; }) ? "Fail" : "Pass";
    replaceRow(db.ipcRecords, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "IPC Record", (rec.ipcNo || rec.id) + " " + rec.ipcType + " - " + rec.result);
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_ipc_record", oldId, "delete"); Sync.mark("t_ipc_record", rec.id); }
    save(); return rec;
  }
  function createIpcRecord(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var rec = {
      id: uid("IPC"), ipcNo: "IPC/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("ipc"), 3),
      ipcType: inp.ipcType || "FR-QA-25", woId: inp.woId || "", woRef: inp.woRef || "",
      campaignNo: inp.campaignNo || "", fgId: inp.fgId || "", checks: inp.checks || [],
      result: "Pass", inspector: db.meta.user.email || db.meta.user.name,
      recordedAt: inp.recordedAt || Engine.nowWIB(), note: inp.note || ""
    };
    return saveIpcRecord(rec, true, null);
  }

  /* ---------- bulk WO execution: BMR phase rows (FR-QA-12 / FR-PR-23) ---------- */
  function phaseById(id) { return db.woBulkPhases.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function phasesFor(woId) {
    return db.woBulkPhases.filter(function (p) { return String(p.woId) === String(woId); })
      .sort(function (a, b) { return (Number(a.phaseNo) || 0) - (Number(b.phaseNo) || 0); });
  }
  function saveBulkPhase(rec, isNew, oldId) {
    replaceRow(db.woBulkPhases, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "BMR Phase", (rec.phaseName || rec.phaseNo) + " " + rec.materialCode + " actual " + Engine.fmtNum(rec.actualKg, 2) + " kg");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_wo_bulk_phase", oldId, "delete"); Sync.mark("t_wo_bulk_phase", rec.id); }
    save(); return rec;
  }
  function deleteBulkPhase(id) {
    var p = phaseById(id); if (!p) return;
    db.woBulkPhases = db.woBulkPhases.filter(function (x) { return String(x.id) !== String(id); });
    audit("DELETE", "BMR Phase", (p.phaseName || p.phaseNo) + " " + p.materialCode);
    if (window.Sync) Sync.mark("t_wo_bulk_phase", id, "delete");
    save();
  }
  /* Bulk WO status walk gated by the FR-QA-21 mixing clearance. */
  function transitionBulkWo(id, status) {
    var wo = db.workOrdersBulk.filter(function (w) { return String(w.id) === String(id); })[0]; if (!wo) return false;
    var ok = window.RBAC ? RBAC.canTransition("workOrderBulk", wo.status, status) : false;
    if (!ok) { audit("DENY", "Bulk WO", (wo.woNo || id) + " - " + wo.status + " \u2192 " + status + " not allowed"); save(); return false; }
    if (status === "InProgress" && !clearancePassed(id, "FR-QA-21")) {
      audit("DENY", "Bulk WO", (wo.woNo || id) + " - FR-QA-21 line clearance not Passed"); save(); return false;
    }
    var from = wo.status; wo.status = status;
    audit("TRANSITION", "Bulk WO", (wo.woNo || id) + " - " + from + " \u2192 " + status);
    if (window.Sync) Sync.mark("t_work_order_bulk", wo.id);
    save(); return true;
  }

  /* ---------- BTIP bulk transfer (FR-PR-21/22) ---------- */
  function btipById(id) { return db.btipTransfers.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function createBtipTransfer(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var rec = {
      id: uid("BTIP"), transferNo: "BTIP/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("btip"), 3),
      woId: inp.woId || "", campaignNo: inp.campaignNo || "", fromVessel: inp.fromVessel || "", toHopper: inp.toHopper || "",
      bulkCode: inp.bulkCode || "", qty: Number(inp.qty) || 0, uom: inp.uom || "Kg",
      transferredBy: inp.transferredBy || db.meta.user.email || db.meta.user.name, qaBy: inp.qaBy || "",
      transferredAt: inp.transferredAt || Engine.nowWIB(), status: "Draft", note: inp.note || ""
    };
    db.btipTransfers.unshift(rec);
    if (window.Sync) Sync.mark("t_btip_transfer", rec.id);
    audit("CREATE", "BTIP Transfer", rec.transferNo + " " + rec.fromVessel + " \u2192 " + rec.toHopper + " " + Engine.fmtNum(rec.qty, 2) + " " + rec.uom);
    save(); return rec;
  }
  function saveBtipTransfer(rec, isNew, oldId) {
    replaceRow(db.btipTransfers, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "BTIP Transfer", rec.transferNo + " [" + rec.status + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_btip_transfer", oldId, "delete"); Sync.mark("t_btip_transfer", rec.id); }
    save(); return rec;
  }

  /* ---------- pack WO execution (BMR filling & packing FR-QA-13) ----------
     rendemen % = actual yield / theoretical output x 100, hard-checked to
     95-100%; outside that band a variance remark is mandatory to close. */
  function packWoById(id) { return db.workOrdersPack.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function rendemenOf(theoretical, actualYield) {
    var t = Number(theoretical) || 0, a = Number(actualYield) || 0;
    return t > 0 ? Engine.round4(a / t * 100) : 0;
  }
  function saveWorkOrderPack(rec, isNew, oldId) {
    rec.rendemenPct = rendemenOf(rec.theoreticalOutput, rec.actualYield);
    replaceRow(db.workOrdersPack, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Pack WO", (rec.woNo || rec.id) + " rendemen " + Engine.fmtNum(rec.rendemenPct, 2) + "% [" + rec.status + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_work_order_pack", oldId, "delete"); Sync.mark("t_work_order_pack", rec.id); }
    save(); return rec;
  }
  function createPackWo(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var rec = {
      id: uid("WOP"), woNo: "WOP/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("wop"), 3),
      campaignNo: inp.campaignNo || "", soId: inp.soId || "", fgId: inp.fgId || "", bulkWoId: inp.bulkWoId || "", bulkCode: inp.bulkCode || "",
      status: "Planned", theoreticalOutput: Number(inp.theoreticalOutput) || 0, rejects: 0, actualYield: 0,
      outputUnit: inp.outputUnit || "pcs", laborHours: 0, machineHours: 0, rendemenPct: 0, varianceRemark: "",
      startedAt: "", doneAt: "", note: inp.note || ""
    };
    return saveWorkOrderPack(rec, true, null);
  }
  function transitionPackWo(id, status) {
    var wo = packWoById(id); if (!wo) return false;
    var ok = window.RBAC ? RBAC.canTransition("workOrderPack", wo.status, status) : false;
    if (!ok) { audit("DENY", "Pack WO", (wo.woNo || id) + " - " + wo.status + " \u2192 " + status + " not allowed"); save(); return false; }
    if (status === "InProgress" && !clearancePassed(id, "FR-QA-22")) {
      audit("DENY", "Pack WO", (wo.woNo || id) + " - FR-QA-22 line clearance not Passed"); save(); return false;
    }
    if (status === "InProgress" && !wo.startedAt) wo.startedAt = Engine.nowWIB();
    if (status === "Done") {
      var r = rendemenOf(wo.theoreticalOutput, wo.actualYield);
      if ((r < 95 || r > 100) && !(wo.varianceRemark && String(wo.varianceRemark).trim())) {
        audit("DENY", "Pack WO", (wo.woNo || id) + " - rendemen " + Engine.fmtNum(r, 2) + "% outside 95-100% and no variance remark"); save(); return false;
      }
      wo.rendemenPct = r; wo.doneAt = Engine.nowWIB();
    }
    var from = wo.status; wo.status = status;
    audit("TRANSITION", "Pack WO", (wo.woNo || id) + " - " + from + " \u2192 " + status + (status === "Done" ? " (rendemen " + Engine.fmtNum(wo.rendemenPct, 2) + "%)" : ""));
    if (window.Sync) Sync.mark("t_work_order_pack", wo.id);
    save(); return true;
  }

  /* ---------- release / disposition (FR-QC-06) ---------- */
  function releaseById(id) { return db.releases.filter(function (x) { return String(x.id) === String(id); })[0] || null; }
  function createRelease(inp) {
    inp = inp || {};
    var date = inp.date || Engine.todayISO();
    var rec = {
      id: uid("REL"), releaseNo: "REL/" + Engine.romanMonth(date) + "/" + Engine.yearOf(date) + "/" + Engine.pad(nextSeq("rel"), 3),
      woPackId: inp.woPackId || "", fgId: inp.fgId || "", campaignNo: inp.campaignNo || "", batchLot: inp.batchLot || "",
      disposition: "Pending", qaCopy: inp.qaCopy || "", qcCopy: inp.qcCopy || "", signer: "", releasedAt: "", note: inp.note || ""
    };
    db.releases.unshift(rec);
    if (window.Sync) Sync.mark("t_release", rec.id);
    audit("CREATE", "Release", rec.releaseNo + " " + (rec.batchLot || rec.fgId) + " - Pending");
    save(); return rec;
  }
  function saveRelease(rec, isNew, oldId) {
    replaceRow(db.releases, "id", oldId || rec.id, rec, false);
    audit(isNew ? "CREATE" : "UPDATE", "Release", rec.releaseNo + " [" + rec.disposition + "]");
    if (window.Sync) { if (!isNew && oldId && oldId !== rec.id) Sync.mark("t_release", oldId, "delete"); Sync.mark("t_release", rec.id); }
    save(); return rec;
  }
  function setReleaseDisposition(id, disposition) {
    var rel = releaseById(id); if (!rel) return false;
    var ok = window.RBAC ? RBAC.canTransition("release", rel.disposition, disposition) : false;
    if (!ok) { audit("DENY", "Release", rel.releaseNo + " - " + rel.disposition + " \u2192 " + disposition + " not allowed"); save(); return false; }
    var from = rel.disposition; rel.disposition = disposition;
    if (disposition === "Approved" || disposition === "Rejected") { rel.signer = db.meta.user.email || db.meta.user.name; rel.releasedAt = Engine.nowWIB(); }
    audit("TRANSITION", "Release", rel.releaseNo + " - " + from + " \u2192 " + disposition);
    if (window.Sync) Sync.mark("t_release", rel.id);
    save(); return true;
  }
  function releaseApproved(woPackId) {
    return db.releases.some(function (r) { return String(r.woPackId) === String(woPackId) && r.disposition === "Approved";
    });
  }

  /* ---------- Simulation & requests ---------- */
  function saveSim(rec) {
    db.sims.unshift(rec);
    audit("CREATE", "Order Simulation", rec.noSim + " " + rec.fgKode + " x " + rec.orderQty);
    if (window.Sync) Sync.mark("sims", rec.id);
    save();
  }
  function saveRequest(rec) {
    db.requests.unshift(rec);
    audit("CREATE", rec.type === "MR" ? "Material Request" : "Purchase Request",
      rec.noDoc + " (" + rec.lines.length + " lines) for " + rec.fgKode);
    if (window.Sync) Sync.mark("requests", rec.id);
    save();
  }

  /* ---------- import / export ---------- */
  function exportJSON() {
    Engine.download("astoria-fg-suite-backup-" + Engine.todayISO() + ".json",
      JSON.stringify(db, null, 2), "application/json");
  }
  function importJSON(text) {
    var obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.fgs) || !Array.isArray(obj.materials)) throw new Error("Not a valid backup file");
    db = obj;
    db.meta.seq = db.meta.seq || { bom: 0, mr: 0, pr: 0, sim: 0 };
    refreshDerived();
    audit("IMPORT", "Database", "Full backup restored");
    if (window.Sync) Sync.markAll();
    save();
  }
  function resetToSample() {
    db = Seed.build();
    refreshDerived();
    if (window.Sync) Sync.markAll();
    save();
  }

  /* Import the Google Sheet Master F/G export (columns A..J) */
  function importMasterCSV(text) {
    var rows = Engine.parseCSV(text);
    if (!rows.length) return 0;
    var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    var idx = { ffs: 3, fps: 4, desc: 1, na: 5, exp: 6, disc: 9, by: 7, upd: 8 };
    var hi = header.indexOf("ffs formula");
    if (hi >= 0) {
      idx.ffs = hi;
      idx.fps = header.indexOf("fps kemas");
      idx.desc = header.indexOf("deskripsi produk");
      idx.na = header.indexOf("kode na");
      idx.exp = header.indexOf("tgl expire na");
      idx.disc = header.findIndex(function (h) { return h.indexOf("diskonti") === 0 || h.indexOf("disconti") === 0; });
      var hby = header.indexOf("diubah oleh"); if (hby >= 0) idx.by = hby;
      var hupd = header.indexOf("waktu update"); if (hupd >= 0) idx.upd = hupd;
      rows = rows.slice(1);
    }
    var count = 0;
    var touched = [];
    rows.forEach(function (r) {
      var ffs = String(r[idx.ffs] || "").trim();
      var fps = String(r[idx.fps] || "").trim();
      if (!ffs && !fps) return;
      var id = ffs + "|" + fps;
      var rec = fgById(id);
      var isNew = !rec;
      if (isNew) rec = { id: id, ffs: ffs, fps: fps, deskripsi: "", kodeNA: "", tglExpire: "", discontinue: false, diubahOleh: "", waktuUpdate: "" };
      rec.ffs = ffs; rec.fps = fps;
      if (idx.desc >= 0) rec.deskripsi = String(r[idx.desc] || "").trim();
      if (idx.na >= 0) rec.kodeNA = String(r[idx.na] || "").trim();
      if (idx.exp >= 0) rec.tglExpire = Engine.toISO(String(r[idx.exp] || "").trim());
      if (idx.disc >= 0) {
        var d = String(r[idx.disc] || "").trim().toUpperCase();
        rec.discontinue = d === "TRUE" || d === "YES" || d.indexOf("DISCONTINUE") >= 0;
      }
      if (idx.by >= 0 && r[idx.by] !== undefined) rec.diubahOleh = String(r[idx.by]).trim();
      if (idx.upd >= 0 && r[idx.upd] !== undefined) rec.waktuUpdate = String(r[idx.upd]).trim();
      if (isNew) db.fgs.push(rec);
      touched.push(rec.id);
      count++;
    });
    refreshDerived();
    audit("IMPORT", "Master F/G", count + " rows imported from Google Sheet CSV");
    if (window.Sync) touched.forEach(function (id) { Sync.mark("fg_master", id); });
    save();
    return count;
  }

  /* Master F/G display order: alphabetical by Kode Produk, tie-break on
     Deskripsi Produk. Used by the CSV export so the shared sheet keeps a
     stable order no matter how often rows are edited. */
  function fgCompare(a, b) {
    return String(a.kodeFG || "").localeCompare(String(b.kodeFG || ""), undefined, { sensitivity: "base" }) ||
      String(a.deskripsi || "").localeCompare(String(b.deskripsi || ""), undefined, { sensitivity: "base" });
  }

  /* Waktu Update strings are not zero-padded ("2026-09-07 8:59:49"), so they
     cannot be compared as text - parse them into a timestamp first. */
  function waktuVal(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(s || "").trim());
    if (!m) return 0;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  }

  /* Master F/G list order: most recently updated first (Waktu Update desc,
     tie-break Kode Produk so equal timestamps keep a stable order). */
  function fgRecentCompare(a, b) {
    return waktuVal(b.waktuUpdate) - waktuVal(a.waktuUpdate) || fgCompare(a, b);
  }

  /* Bill of Material Finish Good picker order: Deskripsi Produk A-Z,
     tie-break Kode Produk. */
  function fgDescCompare(a, b) {
    return String(a.deskripsi || "").localeCompare(String(b.deskripsi || ""), undefined, { sensitivity: "base" }) ||
      String(a.kodeFG || "").localeCompare(String(b.kodeFG || ""), undefined, { sensitivity: "base" });
  }

  function exportMasterCSV() {
    var rows = [["Kode Produk Finish Good", "Deskripsi Produk", "Status F/G", "FFS Formula",
      "FPS Kemas", "Kode NA", "Tgl Expire NA", "Diubah Oleh", "Waktu Update", "Discontinue / Revisi Flag"]];
    db.fgs.slice().sort(fgCompare).forEach(function (f) {
      rows.push([f.kodeFG, f.deskripsi, f.status, f.ffs, f.fps, f.kodeNA, f.tglExpire,
        f.diubahOleh, f.waktuUpdate, f.discontinue ? "TRUE" : "FALSE"]);
    });
    Engine.download("master-fg-list-" + Engine.todayISO() + ".csv", Engine.toCSV(rows), "text/csv;charset=utf-8");
  }

  return {
    load: load, get: get, save: save, hydrate: hydrate, setUser: setUser,
    refreshDerived: refreshDerived, runExpiryAudit: runExpiryAudit,
    audit: audit, nextSeq: nextSeq, uid: uid,
    matMap: matMap, fgById: fgById, bomByFg: bomByFg,
    fgCompare: fgCompare, fgRecentCompare: fgRecentCompare, fgDescCompare: fgDescCompare,
    saveFG: saveFG, deleteFG: deleteFG, reviseFG: reviseFG,
    saveMaterial: saveMaterial, deleteMaterial: deleteMaterial,
    saveCustomer: saveCustomer, deleteCustomer: deleteCustomer, customerById: customerById,
    saveFormula: saveFormula, deleteFormula: deleteFormula, formulaById: formulaById,
    savePackaging: savePackaging, deletePackaging: deletePackaging, packagingById: packagingById,
    saveMixer: saveMixer, deleteMixer: deleteMixer, mixerById: mixerById,
    saveBOM: saveBOM, deleteBOM: deleteBOM,
    soById: soById, saveSalesOrder: saveSalesOrder, transitionSO: transitionSO, deleteSalesOrder: deleteSalesOrder,
    savePpicRun: savePpicRun,
    txnById: txnById, netLedger: netLedger, sohOf: sohOf, openingOf: openingOf,
    allocatedOf: allocatedOf, availableOf: availableOf, ledgerFor: ledgerFor, postTxn: postTxn,
    poById: poById, createPoFromPr: createPoFromPr, savePurchaseOrder: savePurchaseOrder, receivePoLine: receivePoLine,
    lotById: lotById, saveLot: saveLot, setLotStatus: setLotStatus,
    reservedOnLot: reservedOnLot, releasedLots: releasedLots, fifoPick: fifoPick,
    stagingById: stagingById, createStaging: createStaging, dispenseStaging: dispenseStaging, cancelStaging: cancelStaging,
    lcById: lcById, clearancesFor: clearancesFor, clearancePassed: clearancePassed,
    createLineClearance: createLineClearance, saveLineClearance: saveLineClearance, setClearanceStatus: setClearanceStatus,
    ipcById: ipcById, ipcLimit: ipcLimit, createIpcRecord: createIpcRecord, saveIpcRecord: saveIpcRecord,
    phaseById: phaseById, phasesFor: phasesFor, saveBulkPhase: saveBulkPhase, deleteBulkPhase: deleteBulkPhase, transitionBulkWo: transitionBulkWo,
    btipById: btipById, createBtipTransfer: createBtipTransfer, saveBtipTransfer: saveBtipTransfer,
    packWoById: packWoById, rendemenOf: rendemenOf, createPackWo: createPackWo, saveWorkOrderPack: saveWorkOrderPack, transitionPackWo: transitionPackWo,
    releaseById: releaseById, createRelease: createRelease, saveRelease: saveRelease, setReleaseDisposition: setReleaseDisposition, releaseApproved: releaseApproved,
    saveSim: saveSim, saveRequest: saveRequest,
    exportJSON: exportJSON, importJSON: importJSON, resetToSample: resetToSample,
    importMasterCSV: importMasterCSV, exportMasterCSV: exportMasterCSV
  };
})();
