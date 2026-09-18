/* ============================================================
   STORE - persistence (browser localStorage), audit trail,
   document sequences, import / export
   ============================================================ */
window.Store = (function () {

  var KEY = "astoria_fg_suite_v1";
  var db = null;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : Seed.build();
      if (!db || !db.meta || !Array.isArray(db.fgs)) db = Seed.build();
    } catch (e) {
      db = Seed.build();
    }
    db.meta.seq = db.meta.seq || { bom: 0, mr: 0, pr: 0, sim: 0 };
    db.meta.user = db.meta.user || { name: "User", email: "", role: "PPIC" };
    db.sims = db.sims || [];
    db.requests = db.requests || [];
    db.audit = db.audit || [];
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
    db.meta.seq = db.meta.seq || { bom: 0, mr: 0, pr: 0, sim: 0 };
    db.meta.user = db.meta.user || { name: "User", email: "", role: "PPIC" };
    db.sims = db.sims || [];
    db.requests = db.requests || [];
    db.audit = db.audit || [];
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
    refreshDerived: refreshDerived,
    audit: audit, nextSeq: nextSeq, uid: uid,
    matMap: matMap, fgById: fgById, bomByFg: bomByFg,
    fgCompare: fgCompare, fgRecentCompare: fgRecentCompare, fgDescCompare: fgDescCompare,
    saveFG: saveFG, deleteFG: deleteFG, reviseFG: reviseFG,
    saveMaterial: saveMaterial, deleteMaterial: deleteMaterial,
    saveBOM: saveBOM, deleteBOM: deleteBOM,
    saveSim: saveSim, saveRequest: saveRequest,
    exportJSON: exportJSON, importJSON: importJSON, resetToSample: resetToSample,
    importMasterCSV: importMasterCSV, exportMasterCSV: exportMasterCSV
  };
})();
