/* ============================================================
   OCR import client - sends a Formula PDF to the self-hosted
   n8n webhook and maps the JSON response onto the m_formula
   shape. Tolerant by design: the RND field set is provisional,
   unknown keys are ignored and unmatched values become blank +
   a warning, never an invented value.
   ============================================================ */
window.OCRImport = (function () {
  "use strict";

  var FORMULA_CATS = ["RM-INT", "RM-EXT", "PREMIX", "RM"];

  /* lowercase, strip punctuation, collapse whitespace - used for
     the last-chance match of customer/material names */
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function num(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(",", "."));
    return isNaN(n) ? null : n;
  }
  function stab(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    if (!s) return "-";
    var hit = ["Running", "Pass", "Fail"].filter(function (x) { return x.toLowerCase() === s; })[0];
    return hit || "-";
  }
  function matchCustomer(raw, db) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || !db || !db.customers) return { id: "", how: "none" };
    var byId = db.customers.filter(function (c) { return c.id === s; })[0];
    if (byId) return { id: byId.id, how: "id" };
    var lower = s.toLowerCase();
    var byName = db.customers.filter(function (c) { return String(c.name || "").trim().toLowerCase() === lower; })[0];
    if (byName) return { id: byName.id, how: "name" };
    var n = norm(s);
    var byNorm = db.customers.filter(function (c) { return norm(c.name) === n; })[0];
    if (byNorm) return { id: byNorm.id, how: "norm" };
    return { id: "", how: "none" };
  }
  /* The editor's material dropdown only offers FORMULA_CATS, so a
     code outside that pool would render blank - reject it here too. */
  function matchMaterial(raw, db) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || !db || !db.materials) return { code: "", how: "none" };
    var pool = db.materials.filter(function (m) { return FORMULA_CATS.indexOf(m.category) >= 0; });
    var byCode = pool.filter(function (m) { return m.code === s; })[0];
    if (byCode) return { code: byCode.code, how: "code" };
    var lower = s.toLowerCase();
    var byName = pool.filter(function (m) { return String(m.name || "").trim().toLowerCase() === lower; })[0];
    if (byName) return { code: byName.code, how: "name" };
    var n = norm(s);
    var byNorm = pool.filter(function (m) { return norm(m.name) === n; })[0];
    if (byNorm) return { code: byNorm.code, how: "norm" };
    return { code: "", how: "none" };
  }
  /* Field-missing warnings are owned by the n8n Normalize node;
     this function only adds master-match warnings, so the two
     sides never duplicate a message. */
  function mapToFormulaDraft(payload, db) {
    var f = (payload && payload.formula) || {};
    var warnings = [].concat((payload && payload.warnings) || []);
    var draft = {
      id: String(f.ffs == null ? "" : f.ffs).trim(),
      kategori: String(f.kategori == null ? "" : f.kategori).trim(),
      customerId: "", urutan: 0,
      bj: num(f.bj), phMin: num(f.phMin), phMax: num(f.phMax),
      viscosity: String(f.viscosity == null ? "" : f.viscosity).trim(),
      stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-",
      note: String(f.note == null ? "" : f.note).trim(),
      lines: []
    };
    var rawCust = String(f.customer == null ? "" : f.customer).trim();
    var mc = matchCustomer(rawCust, db);
    draft.customerId = mc.id;
    if (!mc.id) {
      warnings.push(rawCust ? "Customer '" + rawCust + "' not found in master - pick it manually"
                            : "Customer not found in the document - pick it manually");
    }
    [["stabTk", f.stabTk], ["stabTkul", f.stabTkul], ["stabT50", f.stabT50], ["stabTm", f.stabTm]]
      .forEach(function (p) {
        var raw = String(p[1] == null ? "" : p[1]).trim();
        draft[p[0]] = stab(raw);
        if (draft[p[0]] === "-" && raw && raw !== "-") {
          warnings.push("Stability " + p[0].slice(4).toUpperCase() + ": unrecognized value '" + raw + "' - set to '-'");
        }
      });
    var inLines = Array.isArray(f.lines) ? f.lines : [];
    inLines.forEach(function (ln, i) {
      ln = ln || {};
      var name = String(ln.materialName == null ? "" : ln.materialName).trim();
      var code = String(ln.materialCode == null ? "" : ln.materialCode).trim();
      if (!name && !code) return;
      var mm = matchMaterial(code, db);
      if (!mm.code && name) mm = matchMaterial(name, db);
      var note = String(ln.note == null ? "" : ln.note).trim();
      var pct = num(ln.pct);
      if (!mm.code) {
        warnings.push("Material '" + (name || code) + "' (line " + (i + 1) + ") not found in master - pick it manually");
        note = (note ? note + " " : "") + "[unmatched: " + (name || code) + "]";
      }
      draft.lines.push({ materialCode: mm.code, pct: pct == null ? 0 : pct, note: note });
    });
    var sum = draft.lines.reduce(function (s, l) { return s + (Number(l.pct) || 0); }, 0);
    if (draft.lines.length && Math.abs(sum - 100) >= 0.01) {
      warnings.push("Composition ratios sum to " + sum.toFixed(3) + "% - should be 100%");
    }
    var existing = null;
    if (draft.id && db && db.formulas) {
      existing = db.formulas.filter(function (x) { return x.id === draft.id; })[0] || null;
    }
    return { draft: draft, warnings: warnings, existing: existing };
  }

  function configured() {
    var c = window.ASTORIA_OCR || {};
    return !!(c.webhookUrl && c.token);
  }
  /* POSTs the file to the n8n webhook. Every rejection message is
     written to be shown to the user as-is. */
  function parsePdf(file, opts) {
    opts = opts || {};
    var cfg = window.ASTORIA_OCR || {};
    if (!configured()) return Promise.reject(new Error("OCR import is not configured - fill webhookUrl and token in supabase-config.js"));
    if (!/\.pdf$/i.test(String((file && file.name) || ""))) return Promise.reject(new Error("Only .pdf files are supported - convert the Word document to PDF first"));
    if (!file || file.size > 10 * 1024 * 1024) return Promise.reject(new Error("The PDF is larger than 10 MB"));
    var timeoutMs = opts.timeoutMs || 120000;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, timeoutMs);
    var fd = new FormData();
    fd.append("file", file, file.name);
    return window.fetch(cfg.webhookUrl, {
      method: "POST",
      headers: { "X-Astoria-Token": cfg.token || "" },
      body: fd,
      signal: ctrl.signal
    }).then(function (res) {
      return res.text().then(function (txt) {
        var body = null;
        try { body = JSON.parse(txt); } catch (e) { body = null; }
        if (body && body.ok === true) return body;
        var err = new Error(body && body.error ? String(body.error)
          : "Unexpected response from n8n (HTTP " + (res.status || 0) + ")");
        err.fromN8n = true;
        throw err;
      });
    }).then(function (body) {
      clearTimeout(timer);
      return body;
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === "AbortError") throw new Error("Timed out waiting for the n8n webhook - try again or enter the formula manually");
      if (err && err.fromN8n) throw err;
      throw new Error("Could not reach the n8n webhook: " + ((err && err.message) || err));
    });
  }

  var api = { configured: configured, norm: norm, num: num, stab: stab,
    matchCustomer: matchCustomer, matchMaterial: matchMaterial,
    mapToFormulaDraft: mapToFormulaDraft, parsePdf: parsePdf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
