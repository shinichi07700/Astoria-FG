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
      id: codeOf(f),
      kategori: String(f.kategori == null ? "" : f.kategori).trim(),
      dosageForm: String(f.dosageForm == null ? "" : f.dosageForm).trim(),
      customerId: "", urutan: 0,
      bj: 1, phMin: "", phMax: "",
      viscosity: "", stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-",
      productName: String(f.productName == null ? "" : f.productName).trim(),
      variant: String(f.variant == null ? "" : f.variant).trim(),
      pdrNo: str(f.pdrNo || f.pdr),
      specialHandling: (Array.isArray(f.specialHandling) ? f.specialHandling : []).map(function (s) {
        s = s || {}; return { material: str(s.material), handling: str(s.handling || s.note) };
      }).filter(function (s) { return s.material || s.handling; }),
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
  function configuredCfg(cfg) {
    return !!(cfg && cfg.webhookUrl && cfg.token);
  }
  /* POSTs the file to the n8n webhook. Every rejection message is
     written to be shown to the user as-is. opts.webhookUrl / opts.token
     select a per-document-type workflow (Settings & Data); without them
     the shipped formula webhook is used. */
  function parsePdf(file, opts) {
    opts = opts || {};
    var cfg = {
      webhookUrl: opts.webhookUrl || (window.ASTORIA_OCR || {}).webhookUrl,
      token: opts.token || (window.ASTORIA_OCR || {}).token
    };
    if (!configuredCfg(cfg)) return Promise.reject(new Error("OCR import is not configured - fill webhookUrl and token in Settings & Data (or supabase-config.js)"));
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

  /* ---------- FFS submodule drafts (lab / stability / machine setup) ----------
     Same tolerant contract as mapToFormulaDraft: unknown keys ignored,
     unmatched masters become blank + a warning, never an invented value.
     n8n payload shapes: { ok, lab|stability|machine, warnings, document }. */
  function str(v) { return String(v == null ? "" : v).trim(); }
  function matchFormula(raw, db) {
    var s = str(raw);
    var hit = s && db && db.formulas ? db.formulas.filter(function (f) { return f.id === s; })[0] : null;
    return hit || null;
  }
  /* The doc "Kode" is the Formula Code. Prompts may emit it as formulaCode,
     ffs or code - accept any so the user's n8n naming never breaks import. */
  function codeOf(f) { return str(f.formulaCode || f.ffs || f.code); }
  function ffsWarning(raw, hit, warnings) {
    if (!hit) warnings.push(str(raw) ? "Formula '" + str(raw) + "' not found in Master Formula - pick it manually"
                                     : "Formula Code not found in the document - pick it manually");
  }
  function parseSpecs(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (s) {
      s = s || {};
      var parameter = str(s.parameter || s.param || s.name);
      var std = str(s.std || s.standard || s.spec || s.value);
      var method = str(s.method || s.instrument);
      if (parameter || std || method) out.push({ parameter: parameter, std: std, method: method });
    });
    return out;
  }
  function mapToLabDraft(payload, db) {
    var f = (payload && (payload.lab || payload.specification)) || {};
    var warnings = [].concat((payload && payload.warnings) || []);
    var code = codeOf(f);
    var hit = matchFormula(code, db);
    ffsWarning(code, hit, warnings);
    var draft = {
      id: hit ? hit.id : code, specs: parseSpecs(f.specs || f.specifications),
      expiry: str(f.expiry || f.shelfLife), sprRef: str(f.sprRef || f.spr),
      storageTemp: str(f.storageTemp || f.storage), note: str(f.note), status: "Draft"
    };
    var existing = draft.id && db && db.formulaLab ? db.formulaLab.filter(function (x) { return x.id === draft.id; })[0] || null : null;
    return { draft: draft, warnings: warnings, existing: existing };
  }
  var STAB_CONDS = ["TK", "TKUL", "T50", "TM"];
  function mapToStabDraft(payload, db) {
    var f = (payload && (payload.stability || payload.testResult)) || {};
    var warnings = [].concat((payload && payload.warnings) || []);
    var code = codeOf(f);
    var hit = matchFormula(code, db);
    ffsWarning(code, hit, warnings);
    var obs = [];
    (Array.isArray(f.obs) ? f.obs : []).forEach(function (o) {
      o = o || {};
      var cond = str(o.cond).toUpperCase();
      if (STAB_CONDS.indexOf(cond) < 0) {
        if (str(o.cond)) warnings.push("Unknown stability condition '" + str(o.cond) + "' - ignored");
        return;
      }
      obs.push({ cond: cond, status: stab(o.status), note: str(o.note), week: num(o.week) || 0 });
    });
    var draft = {
      id: hit ? hit.id : code, startDate: str(f.startDate), protocol: str(f.protocol),
      weeksTotal: num(f.weeksTotal) || 0, weeksObserved: num(f.weeksObserved) || 0,
      obs: obs, panelRef: str(f.panelRef || f.panel), microRef: str(f.microRef || f.micro),
      compatRef: str(f.compatRef || f.compat), stabRef: str(f.stabRef || f.stabilityRef),
      note: str(f.note), status: "Draft"
    };
    var existing = draft.id && db && db.formulaStab ? db.formulaStab.filter(function (x) { return x.id === draft.id; })[0] || null : null;
    return { draft: draft, warnings: warnings, existing: existing };
  }
  function matchMixer(raw, db) {
    var s = str(raw);
    if (!s || !db || !db.mixers) return null;
    return db.mixers.filter(function (m) { return m.id === s; })[0] ||
      db.mixers.filter(function (m) { return String(m.name || "").trim().toLowerCase() === s.toLowerCase(); })[0] || null;
  }
  function parseEquipment(raw) {
    return (Array.isArray(raw) ? raw : []).map(function (e) {
      return typeof e === "string" ? str(e) : str(e && (e.name || e.equipment));
    }).filter(Boolean);
  }
  /* One machine / batch-size param-set. Expected prompt keys: machine (name or
     id), batchLabel, suhu, homogenizer, disperser, mixer (Hz), scraper, time,
     timeType. The machine is matched to the mixer catalogue; an unmatched name
     becomes blank + a warning, never an invented id. */
  function parseParamSet(ps, db, warnings) {
    ps = ps || {};
    var rawMachine = str(ps.machine || ps.mixerId || ps.mixerName);
    var m = matchMixer(rawMachine, db);
    if (rawMachine && !m) warnings.push("Machine '" + rawMachine + "' not found in catalogue - pick it manually");
    var tt = str(ps.timeType);
    return {
      mixerId: m ? m.id : "", batchLabel: str(ps.batchLabel || ps.batch || ps.batchSize),
      suhu: str(ps.suhu || ps.temp), homogenizer: str(ps.homogenizer), disperser: str(ps.disperser),
      mixer: str(ps.mixerSpeed || ps.mixerHz || ps.mixer), scraper: str(ps.scraper),
      time: str(ps.time || ps.minutes),
      timeType: ["Pengadukan", "Mixing", "Pendinginan"].indexOf(tt) >= 0 ? tt : "Pengadukan"
    };
  }
  function parsePhases(raw, db, warnings) {
    var phases = [];
    (Array.isArray(raw) ? raw : []).forEach(function (p) {
      p = p || {};
      var name = str(p.name);
      var steps = [];
      if (Array.isArray(p.steps) && p.steps.length) {
        p.steps.forEach(function (st) {
          st = st || {};
          var mats = Array.isArray(st.materials)
            ? st.materials.map(function (x) { return str(x); }).filter(Boolean)
            : str(st.materials).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
          var params = (Array.isArray(st.params) ? st.params : []).map(function (ps) { return parseParamSet(ps, db, warnings); });
          if (!params.length) params = [parseParamSet(st, db, warnings)];
          steps.push({
            materials: mats, instruction: str(st.instruction || st.note), vessel: str(st.vessel),
            ccp: !!st.ccp, ccpNote: str(st.ccpNote), outputLabel: str(st.outputLabel || st.output), params: params
          });
        });
      } else if (name || str(p.temp) || str(p.rpm) || p.minutes != null || str(p.note)) {
        /* Legacy flat phase -> one step. The ambiguous rpm is kept in the
           instruction text so no extracted value is silently lost. */
        var instr = str(p.note);
        if (str(p.rpm)) instr = (instr ? instr + " " : "") + "[speed: " + str(p.rpm) + " rpm]";
        steps.push({
          materials: [], instruction: instr, vessel: str(p.vessel), ccp: false, ccpNote: "", outputLabel: "",
          params: [parseParamSet({ suhu: str(p.temp), time: str(p.minutes), machine: str(p.mixer) }, db, warnings)]
        });
      }
      if (name || steps.length) phases.push({ name: name, steps: steps });
    });
    return phases;
  }
  function mapToMachineDraft(payload, db) {
    var f = (payload && payload.machine) || {};
    var warnings = [].concat((payload && payload.warnings) || []);
    var code = codeOf(f);
    var hit = matchFormula(code, db);
    ffsWarning(code, hit, warnings);
    var rawMixer = str(f.mixer);
    var mixer = matchMixer(rawMixer, db);
    if (rawMixer && !mixer) warnings.push("Mixer '" + rawMixer + "' not found in catalogue - pick it manually");
    var draft = {
      id: hit ? hit.id : code, mixerId: mixer ? mixer.id : "", mixerName: mixer ? mixer.name : rawMixer,
      vessel: str(f.vessel), equipment: parseEquipment(f.equipment),
      phases: parsePhases(f.phases, db, warnings), vacuum: str(f.vacuum), note: str(f.note), status: "Draft"
    };
    var existing = draft.id && db && db.formulaMachine ? db.formulaMachine.filter(function (x) { return x.id === draft.id; })[0] || null : null;
    return { draft: draft, warnings: warnings, existing: existing };
  }

  var api = { configured: configured, configuredCfg: configuredCfg, norm: norm, num: num, stab: stab,
    matchCustomer: matchCustomer, matchMaterial: matchMaterial,
    mapToFormulaDraft: mapToFormulaDraft, mapToLabDraft: mapToLabDraft,
    mapToStabDraft: mapToStabDraft, mapToMachineDraft: mapToMachineDraft, parsePdf: parsePdf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
