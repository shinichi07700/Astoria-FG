# Formula PDF Import (n8n + OpenAI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let R&D staff import a digitally-exported Formula PDF into the Master Formula editor — n8n extracts the text, OpenAI parses it to JSON, the web app pre-fills the existing editor for human confirmation, and saving goes through the existing audited sync path.

**Architecture:** A new browser module `assets/js/ocr-import.js` (singleton `window.OCRImport`) POSTs the PDF to a self-hosted n8n webhook, validates/maps the JSON response onto the existing `m_formula` shape with per-value warnings, and hands a prefilled draft to the existing `formulaEditor()`. A new importable n8n workflow (`integrations/n8n/formula-ocr.workflow.json`) does Extract-from-File → text-layer check → OpenAI structured parse → normalization, always responding HTTP 200 with `{ok:…}`. Zero Supabase schema changes.

**Tech Stack:** Vanilla ES5-style JS (IIFE + `window.X`, no build step), n8n ≥ 1.x with LangChain nodes (`@n8n/n8n-nodes-langchain`), OpenAI `gpt-4o-mini` (temperature 0). Tests: plain Node scripts, no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-01-formula-pdf-import-design.md`

## Global Constraints

- **No Supabase changes**: no new tables, migrations, or storage buckets. Saving an imported formula uses the existing `Store.saveFormula()` + debounced sync path only.
- **Provisional field set / tolerant contract**: the captured fields may change after the RND Formula meeting — unknown response keys are ignored by the app, missing/unreadable keys become `null`/`""` plus a `warnings[]` entry, and values are never invented. Adding/removing a captured field must be doable by editing only the n8n prompt (browser code tolerates the rest).
- **Wire contract (exact)**: request is `multipart/form-data` with one binary field named `file`, header `X-Astoria-Token: <token>`. Every n8n response is HTTP 200 with either `{ "ok": true, "document": {...}, "formula": {...}, "warnings": [...] }` or `{ "ok": false, "error": "..." }`.
- **Limits**: `.pdf` only, ≤ 10 MB, client abort at 120 s, n8n `executionTimeout: 120`.
- **FROZEN stability enum**: `-`, `Running`, `Pass`, `Fail`. Unrecognized values clamp to `-` + warning.
- **No new browser dependencies, no build step**: plain script tag; tests are dependency-free Node scripts following the `tests/netting.test.js` pattern.
- **Version bump**: every `?v=` query tag in `index.html` bumps together 29 → 30 (24 tags after adding the new script). Never bump some tags only.
- **How the app runs**: served over HTTP(S). Opening from `file://` breaks the CORS call to n8n — the import feature requires a served origin (label this in copy/README, no code guard).
- **Security**: the `X-Astoria-Token` lives in `supabase-config.js` and is client-visible (accepted: abuse costs only OpenAI credits; rotate if leaked). The `service_role` key must NEVER appear in browser code.
- **App-side mapping warnings only cover master-match failures** (customer/material not found, sigma ≠ 100). Field-missing warnings belong to the n8n Normalize node — do not duplicate them in the browser.
- Node tests must run on the plain `node tests/<file>.js` invocation used by the existing suite (Node 24 is installed; `fetch`/`FormData`/`AbortController` are globals there).

---

### Task 1: Mapping core — `window.OCRImport` (pure functions) + headless tests

**Files:**
- Create: `assets/js/ocr-import.js`
- Test: `tests/ocr-import.test.js`

**Interfaces:**
- Consumes: nothing (pure functions over a `db` snapshot passed as an argument).
- Produces (used by Task 2 and Task 4):
  - `OCRImport.norm(str) -> string`
  - `OCRImport.num(v) -> number|null`
  - `OCRImport.stab(v) -> "-"|"Running"|"Pass"|"Fail"`
  - `OCRImport.matchCustomer(raw, db) -> { id: string, how: "id"|"name"|"norm"|"none" }`
  - `OCRImport.matchMaterial(raw, db) -> { code: string, how: "code"|"name"|"norm"|"none" }`
  - `OCRImport.mapToFormulaDraft(payload, db) -> { draft, warnings, existing }` — `draft` keys: `id, kategori, customerId, urutan, bj, phMin, phMax, viscosity, stabTk, stabTkul, stabT50, stabTm, note, lines[{materialCode, pct, note}]`; `existing` is the matching record from `db.formulas` or `null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/ocr-import.test.js`:

```js
/* ============================================================
   Golden-vector unit tests for the OCR import mapping core and
   the n8n webhook client. Run: node tests/ocr-import.test.js
   Exits non-zero on any failure. No external dependencies.
   Requires Node >= 20 (AbortController + FormData are globals).
   ============================================================ */
global.window = {};                /* ocr-import.js assigns window.OCRImport at load */
var O = require("../assets/js/ocr-import.js");

var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = (typeof want === "number")
    ? Math.abs(Number(got) - want) < 1e-6
    : got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}

var DB = {
  customers: [
    { id: "C-001", name: "PT ABC Beauty" },
    { id: "C-002", name: "CV Sinar Jaya" }
  ],
  materials: [
    { code: "RM-1001", name: "Glycerin USP",     category: "RM-INT" },
    { code: "RM-1002", name: "Xanthan Gum",      category: "RM-EXT" },
    { code: "PR-2001", name: "Premix A",         category: "PREMIX" },
    { code: "PK-3001", name: "Pump Bottle 100 mL", category: "KEMAS-INT" }
  ],
  formulas: [ { id: "MR03-BN-01", kategori: "Cream" } ]
};

/* ---------- 1. norm / num / stab ---------- */
eq("norm punctuation-collapsed", O.norm("PT. ABC  Beauty"), "pt abc beauty");
eq("norm null-safe", O.norm(null), "");
eq("num decimal", O.num("1.02"), 1.02);
eq("num comma decimal", O.num("62,5"), 62.5);
eq("num empty -> null", O.num(""), null);
eq("num garbage -> null", O.num("abc"), null);
eq("stab pass (case fold)", O.stab("pass"), "Pass");
eq("stab running", O.stab(" Running "), "Running");
eq("stab fail", O.stab("FAIL"), "Fail");
eq("stab dash", O.stab("-"), "-");
eq("stab empty", O.stab(""), "-");
eq("stab unknown -> dash", O.stab("n/a"), "-");

/* ---------- 2. customer matching cascade ---------- */
eq("customer by id",     O.matchCustomer("C-002", DB).id, "C-002");
eq("customer by name",   O.matchCustomer("pt abc beauty", DB).id, "C-001");
eq("customer by norm",   O.matchCustomer("PT.  ABC Beauty", DB).id, "C-001");
eq("customer unknown",   O.matchCustomer("Unknown Co", DB).id, "");
eq("customer unknown how", O.matchCustomer("Unknown Co", DB).how, "none");
eq("customer blank",     O.matchCustomer("", DB).id, "");

/* ---------- 3. material matching cascade (FORMULA_CATS pool only) ---------- */
eq("material by code",   O.matchMaterial("RM-1001", DB).code, "RM-1001");
eq("material by name ci", O.matchMaterial("glycerin usp", DB).code, "RM-1001");
eq("material by norm",   O.matchMaterial("Xanthan  Gum", DB).code, "RM-1002");
eq("material premix",    O.matchMaterial("Premix A", DB).code, "PR-2001");
eq("material kemas rejected", O.matchMaterial("PK-3001", DB).code, "");
eq("material unknown",   O.matchMaterial("Mystery Powder", DB).code, "");
eq("material blank",     O.matchMaterial("", DB).code, "");

/* ---------- 4. golden payload mapping ---------- */
var PAYLOAD = {
  ok: true,
  document: { fileName: "MR03-BN-01.pdf", pages: 2, parser: "openai" },
  formula: {
    ffs: " MR03-BN-01 ",
    kategori: "Cream",
    customer: "PT. ABC  Beauty",
    bj: "1.02",
    phMin: 5.2,
    phMax: 5.8,
    viscosity: "20000 - 30000 cP",
    stabTk: "pass",
    stabTkul: "Pass",
    stabT50: "Running",
    stabTm: "n/a",
    note: "mix at 60C",
    density: 0.99,                        /* unknown key - must be ignored */
    lines: [
      { materialName: "Glycerin USP", materialCode: "", pct: 62.5, note: "" },
      { materialName: "Mystery Powder", materialCode: "", pct: 37.5, note: "from supplier X" },
      { materialName: "", materialCode: "", pct: 10, note: "" },
      { materialName: "Xanthan Gum", materialCode: "RM-1002", pct: 5, note: "" }
    ]
  },
  warnings: ["BJ guessed from table"]
};
var R = O.mapToFormulaDraft(PAYLOAD, DB);

eq("map ffs trimmed", R.draft.id, "MR03-BN-01");
eq("map kategori", R.draft.kategori, "Cream");
eq("map customer resolved", R.draft.customerId, "C-001");
eq("map bj numeric", R.draft.bj, 1.02);
eq("map phMin", R.draft.phMin, 5.2);
eq("map viscosity", R.draft.viscosity, "20000 - 30000 cP");
eq("map stabTk case-folded", R.draft.stabTk, "Pass");
eq("map stabTm clamped", R.draft.stabTm, "-");
eq("map note", R.draft.note, "mix at 60C");
eq("map line count (nameless dropped)", R.draft.lines.length, 3);
eq("map line1 code", R.draft.lines[0].materialCode, "RM-1001");
eq("map line1 pct", R.draft.lines[0].pct, 62.5);
eq("map line2 code blank", R.draft.lines[1].materialCode, "");
eq("map line2 note keeps source + tag", R.draft.lines[1].note, "from supplier X [unmatched: Mystery Powder]");
eq("map line3 is Xanthan", R.draft.lines[2].materialCode, "RM-1002");
count++;
var sig = R.warnings.filter(function (w) { return w.indexOf("sum to 105.000") >= 0; })[0];
var tmW = R.warnings.filter(function (w) { return w.indexOf("Stability TM") >= 0; })[0];
var matW = R.warnings.filter(function (w) { return w.indexOf("Mystery Powder") >= 0; })[0];
var custW = R.warnings.filter(function (w) { return w.indexOf("Customer") >= 0; })[0];
if (!sig || !tmW || !matW) { fails++; console.log("FAIL map warnings expected sigma+stabTM+material, got=" + JSON.stringify(R.warnings)); }
else console.log("PASS map warnings sigma+stabTM+material");
eq("map ok payload has no customer warning", !!custW, false);
eq("map passthrough n8n warning", R.warnings.indexOf("BJ guessed from table") >= 0, true);
eq("map existing found", !!(R.existing && R.existing.id === "MR03-BN-01"), true);

/* ---------- 5. missing-field payload ---------- */
var R2 = O.mapToFormulaDraft({ ok: true, formula: { kategori: "Lotion" } }, DB);
eq("missing ffs -> blank id", R2.draft.id, "");
eq("missing bj -> null", R2.draft.bj, null);
eq("missing stabs -> dash", R2.draft.stabTk + R2.draft.stabTkul + R2.draft.stabT50 + R2.draft.stabTm, "----");
eq("missing customer warning", R2.warnings.filter(function (w) { return w.indexOf("Customer not found in the document") >= 0; }).length, 1);
eq("missing payload no existing", R2.existing, null);
eq("missing payload no sigma warning", R2.warnings.filter(function (w) { return w.indexOf("sum to") >= 0; }).length, 0);

/* ---------- summary ---------- */
console.log("\n" + (fails ? "RESULT: FAIL (" + fails + "/" + count + ")" : "RESULT: ALL PASS (" + count + ")"));
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/ocr-import.test.js`
Expected: FAIL — `Cannot find module '../assets/js/ocr-import.js'`

- [ ] **Step 3: Write the mapping core**

Create `assets/js/ocr-import.js` (mapping core only — `parsePdf` is added in Task 2):

```js
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

  var api = { norm: norm, num: num, stab: stab,
    matchCustomer: matchCustomer, matchMaterial: matchMaterial,
    mapToFormulaDraft: mapToFormulaDraft };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/ocr-import.test.js`
Expected: `RESULT: ALL PASS` (exit 0)

- [ ] **Step 5: Commit**

```bash
git add assets/js/ocr-import.js tests/ocr-import.test.js
git commit -m "OCR import: tolerant PDF->draft mapping core + headless tests"
```

---

### Task 2: n8n webhook client — `OCRImport.parsePdf` + async tests

**Files:**
- Modify: `assets/js/ocr-import.js` (add `configured()` + `parsePdf()`; extend export)
- Test: `tests/ocr-import.test.js` (append async section)

**Interfaces:**
- Consumes: `window.ASTORIA_OCR = { webhookUrl, token }` from `supabase-config.js` (Task 4 adds the empty block; tests stub `window.ASTORIA_OCR` directly).
- Produces (used by Task 4):
  - `OCRImport.configured() -> boolean`
  - `OCRImport.parsePdf(file, opts?) -> Promise<successBody>`; `opts.timeoutMs` (default 120000, tests pass 25–50). Rejects with `Error` whose `message` is already user-facing toast copy:
    - `"OCR import is not configured - fill webhookUrl and token in supabase-config.js"`
    - `"Only .pdf files are supported - convert the Word document to PDF first"`
    - `"The PDF is larger than 10 MB"`
    - `"Timed out waiting for the n8n webhook - try again or enter the formula manually"`
    - `"Could not reach the n8n webhook: <cause>"`
    - n8n's own `error` text verbatim when `ok:false`
    - `"Unexpected response from n8n (HTTP <status>)"` for non-JSON bodies

- [ ] **Step 1: Write the failing async tests**

Append to `tests/ocr-import.test.js`, replacing the summary block at the end (keep the summary + `process.exit` for last):

```js
/* ---------- 6. parsePdf (stubbed fetch) ---------- */
function makeFile(name, size) {
  var f = new File(["x"], name, { type: "application/pdf" });
  if (size) Object.defineProperty(f, "size", { value: size });
  return f;
}
function stubFetch(handler) { window.fetch = handler; }
function testRejects(name, promise, wantSub) {
  return promise.then(function () {
    count++; fails++;
    console.log("FAIL " + name + " - resolved, expected rejection");
  }, function (err) {
    count++;
    var msg = (err && err.message) || String(err);
    if (msg.indexOf(wantSub) >= 0) { console.log("PASS " + name); }
    else { fails++; console.log("FAIL " + name + "  got='" + msg + "' want substring='" + wantSub + "'"); }
  });
}

(async function () {
  window.ASTORIA_OCR = { webhookUrl: "", token: "" };
  eq("configured false when blank", O.configured(), false);
  await testRejects("parsePdf rejects unconfigured",
    O.parsePdf(makeFile("a.pdf")), "not configured");

  window.ASTORIA_OCR = { webhookUrl: "https://example.invalid/hook", token: "tok-123" };
  eq("configured true when filled", O.configured(), true);
  await testRejects("parsePdf rejects non-pdf",
    O.parsePdf(makeFile("formula.docx")), "Only .pdf files");
  await testRejects("parsePdf rejects >10MB",
    O.parsePdf(makeFile("big.pdf", 11 * 1024 * 1024)), "larger than 10 MB");

  /* success: assert URL, method, token header, multipart field 'file' */
  var seen = null;
  stubFetch(function (url, init) {
    seen = { url: url, init: init };
    return Promise.resolve({
      status: 200,
      text: function () { return Promise.resolve(JSON.stringify({ ok: true, formula: { ffs: "X" }, warnings: [] })); }
    });
  });
  var body = await O.parsePdf(makeFile("a.pdf"));
  eq("parsePdf resolves ok body", body.ok, true);
  eq("parsePdf posts webhook URL", seen.url, "https://example.invalid/hook");
  eq("parsePdf method POST", seen.init.method, "POST");
  eq("parsePdf token header", seen.init.headers["X-Astoria-Token"], "tok-123");
  eq("parsePdf multipart field 'file'", seen.init.body.get("file").name, "a.pdf");
  eq("parsePdf passes abort signal", typeof seen.init.signal, "object");

  /* ok:false -> n8n error text */
  stubFetch(function () {
    return Promise.resolve({ status: 200, text: function () {
      return Promise.resolve(JSON.stringify({ ok: false, error: "This looks like a scanned PDF. Please provide a digitally exported PDF." }));
    } });
  });
  await testRejects("parsePdf surfaces ok:false error",
    O.parsePdf(makeFile("a.pdf")), "scanned PDF");

  /* non-JSON body -> status message */
  stubFetch(function () {
    return Promise.resolve({ status: 502, text: function () { return Promise.resolve("<html>bad gateway</html>"); } });
  });
  await testRejects("parsePdf handles non-JSON",
    O.parsePdf(makeFile("a.pdf")), "Unexpected response from n8n (HTTP 502)");

  /* network failure */
  stubFetch(function () { return Promise.reject(new TypeError("Failed to fetch")); });
  await testRejects("parsePdf wraps network error",
    O.parsePdf(makeFile("a.pdf")), "Could not reach the n8n webhook");

  /* abort -> timeout message */
  stubFetch(function (url, init) {
    return new Promise(function (resolve, reject) {
      init.signal.addEventListener("abort", function () {
        var e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    });
  });
  await testRejects("parsePdf times out on abort",
    O.parsePdf(makeFile("a.pdf"), { timeoutMs: 25 }), "Timed out waiting for the n8n webhook");

  /* ---------- summary ---------- */
  console.log("\n" + (fails ? "RESULT: FAIL (" + fails + "/" + count + ")" : "RESULT: ALL PASS (" + count + ")"));
  process.exit(fails ? 1 : 0);
})();
```

When appending, first delete the Task 1 file's last three lines (`/* ---------- summary ---------- */`, the `console.log(...)` RESULT line, and `process.exit(...)`): the file must end with exactly one summary + `process.exit` — the one inside the async IIFE.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tests/ocr-import.test.js`
Expected: Task 1 vectors still PASS; then FAIL — `O.configured is not a function` (or `parsePdf` undefined).

- [ ] **Step 3: Implement `configured` + `parsePdf`**

In `assets/js/ocr-import.js`, insert before the `var api = {` line:

```js
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
```

Extend the export object to:

```js
  var api = { configured: configured, norm: norm, num: num, stab: stab,
    matchCustomer: matchCustomer, matchMaterial: matchMaterial,
    mapToFormulaDraft: mapToFormulaDraft, parsePdf: parsePdf };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/ocr-import.test.js`
Expected: `RESULT: ALL PASS` (exit 0). Also re-run the existing suite to prove nothing else broke: `node tests/netting.test.js` → `RESULT: ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add assets/js/ocr-import.js tests/ocr-import.test.js
git commit -m "OCR import: n8n webhook client with timeout + error handling"
```

---

### Task 3: n8n workflow template + setup guide

**Files:**
- Create: `integrations/n8n/formula-ocr.workflow.json`
- Create: `integrations/n8n/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime; the response shape it produces must match the contract that Task 1's mapping already tolerates.
- Produces: an importable n8n workflow whose production webhook URL + Header-Auth token are pasted into `window.ASTORIA_OCR` in Task 4.

- [ ] **Step 1: Write the workflow JSON**

Create `integrations/n8n/formula-ocr.workflow.json`:

```json
{
  "name": "Astoria - Formula PDF OCR",
  "nodes": [
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "astoria/formula-ocr",
        "responseMode": "responseNode",
        "options": { "allowedOrigins": "*" }
      },
      "id": "a1b2c3d4-0001-4000-8000-000000000001",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [200, 300],
      "webhookId": "8f1e6c40-2f3a-4b8e-9d21-6c5a7e0b1a44"
    },
    {
      "parameters": { "operation": "pdf", "binaryPropertyName": "file" },
      "id": "a1b2c3d4-0002-4000-8000-000000000002",
      "name": "Extract from File",
      "type": "n8n-nodes-base.extractFromFile",
      "typeVersion": 1,
      "position": [420, 300],
      "onError": "continueErrorOutput"
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose", "version": 2 },
          "conditions": [
            {
              "id": "cond-text-layer",
              "leftValue": "={{ ($json.text || \"\").length }}",
              "rightValue": 100,
              "operator": { "type": "number", "operation": "gte" }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "a1b2c3d4-0003-4000-8000-000000000003",
      "name": "Has Text Layer?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [640, 220]
    },
    {
      "parameters": {
        "promptType": "define",
        "text": "=You are parsing a cosmetic product formula PDF from PT Astoria Prima. The raw extracted text is below between <document> tags. Extract exactly what is printed - never invent, guess or calculate a value that is not present.\n\nReturn ONLY a JSON object with this exact shape:\n{\n  \"ffs\": \"formula code, e.g. MR03-BN-01\",\n  \"kategori\": \"product category as printed\",\n  \"customer\": \"customer name as printed\",\n  \"bj\": number or null,\n  \"phMin\": number or null,\n  \"phMax\": number or null,\n  \"viscosity\": \"range as printed, e.g. '20000 - 30000 cP'\",\n  \"stabTk\": \"Running | Pass | Fail | -\",\n  \"stabTkul\": \"Running | Pass | Fail | -\",\n  \"stabT50\": \"Running | Pass | Fail | -\",\n  \"stabTm\": \"Running | Pass | Fail | -\",\n  \"note\": \"any general note\",\n  \"lines\": [ { \"materialName\": \"as printed\", \"materialCode\": \"code if printed, else empty\", \"pct\": number, \"note\": \"\" } ]\n}\n\nRules:\n- Values not present in the document must be null (numbers) or \"\" (strings) - never guessed.\n- Percentages must sum to 100 across lines; copy them exactly as printed.\n- If there are multiple formula tables, parse the first/main one only.\n- Output raw JSON only, no markdown fences, no commentary.\n\n<document>\n{{ $json.text }}\n</document>"
      },
      "id": "a1b2c3d4-0004-4000-8000-000000000004",
      "name": "Extract Formula (OpenAI)",
      "type": "@n8n/n8n-nodes-langchain.chainLlm",
      "typeVersion": 1.4,
      "position": [880, 220]
    },
    {
      "parameters": {
        "model": "gpt-4o-mini",
        "options": { "temperature": 0 }
      },
      "id": "a1b2c3d4-0005-4000-8000-000000000005",
      "name": "OpenAI Chat Model",
      "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
      "typeVersion": 1.2,
      "position": [880, 420]
    },
    {
      "parameters": {
        "jsCode": "const strip = (s) => String(s == null ? \"\" : s).trim();\nconst num = (v) => {\n  if (v == null || v === \"\") return null;\n  const n = Number(String(v).replace(\",\", \".\"));\n  return isNaN(n) ? null : n;\n};\nconst stab = (v) => {\n  const s = strip(v).toLowerCase();\n  if (!s) return \"-\";\n  if (s === \"running\") return \"Running\";\n  if (s === \"pass\") return \"Pass\";\n  if (s === \"fail\") return \"Fail\";\n  return \"-\";\n};\n\nlet raw = \"\";\nfor (const item of $input.all()) {\n  raw += strip(item.json.text || item.json.output || item.json.response || \"\");\n}\nraw = raw.replace(/^```(?:json)?/i, \"\").replace(/```$/, \"\").trim();\n\nlet parsed = null;\nlet ok = false;\ntry {\n  parsed = JSON.parse(raw);\n  ok = !!parsed;\n} catch (e) {\n  ok = false;\n}\nif (!ok) {\n  return [{ json: { ok: false, error: \"OpenAI did not return valid JSON - try again or enter the formula manually\" } }];\n}\n\nconst warnings = [];\nconst missing = (label, v) => { if (v == null || v === \"\") warnings.push(label + \" not found in document - please fill in\"); };\n\nconst formula = {\n  ffs: strip(parsed.ffs),\n  kategori: strip(parsed.kategori),\n  customer: strip(parsed.customer),\n  bj: num(parsed.bj),\n  phMin: num(parsed.phMin),\n  phMax: num(parsed.phMax),\n  viscosity: strip(parsed.viscosity),\n  stabTk: stab(parsed.stabTk),\n  stabTkul: stab(parsed.stabTkul),\n  stabT50: stab(parsed.stabT50),\n  stabTm: stab(parsed.stabTm),\n  note: strip(parsed.note),\n  lines: []\n};\n\nmissing(\"Formula code (FFS)\", formula.ffs);\nmissing(\"Category\", formula.kategori);\nmissing(\"Customer\", formula.customer);\nmissing(\"Viscosity\", formula.viscosity);\nif (formula.bj == null) warnings.push(\"BJ not found in document - please fill in\");\n\nconst stabWarn = (key, rawVal) => {\n  const r = strip(rawVal);\n  if (r && r !== \"-\" && formula[key] === \"-\") {\n    warnings.push(\"Stability \" + key.slice(4).toUpperCase() + \": unrecognized value '\" + r + \"' - set to '-'\");\n  }\n};\nstabWarn(\"stabTk\", parsed.stabTk);\nstabWarn(\"stabTkul\", parsed.stabTkul);\nstabWarn(\"stabT50\", parsed.stabT50);\nstabWarn(\"stabTm\", parsed.stabTm);\n\nconst inLines = Array.isArray(parsed.lines) ? parsed.lines : [];\nfor (const ln of inLines) {\n  const name = strip(ln && ln.materialName);\n  const code = strip(ln && ln.materialCode);\n  if (!name && !code) continue;\n  const pct = num(ln && ln.pct);\n  formula.lines.push({ materialName: name, materialCode: code, pct: pct == null ? 0 : pct, note: strip(ln && ln.note) });\n}\nif (!formula.lines.length) warnings.push(\"No composition lines found in document - add materials manually\");\n\nlet fileName = \"upload.pdf\";\ntry {\n  const wh = $(\"Webhook\").first();\n  if (wh.binary && wh.binary.file && wh.binary.file.fileName) fileName = wh.binary.file.fileName;\n} catch (e) { /* keep fallback */ }\n\nconst document = { fileName, pages: null, parser: \"openai\" };\nreturn [{ json: { ok: true, document, formula, warnings } }];"
      },
      "id": "a1b2c3d4-0006-4000-8000-000000000006",
      "name": "Normalize Response",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1120, 220]
    },
    {
      "parameters": {
        "jsCode": "const items = $input.all();\nconst j = (items[0] && items[0].json) || {};\nlet msg;\nif (j.error) {\n  msg = \"Could not read the PDF: \" + String(j.error.message || j.error);\n} else {\n  msg = \"This looks like a scanned PDF (no text layer found). Please provide a digitally exported PDF.\";\n}\nreturn [{ json: { ok: false, error: msg } }];"
      },
      "id": "a1b2c3d4-0007-4000-8000-000000000007",
      "name": "Build Error Response",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [880, 520]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ $json }}",
        "options": { "responseCode": 200 }
      },
      "id": "a1b2c3d4-0008-4000-8000-000000000008",
      "name": "Respond to Webhook",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [1360, 340]
    }
  ],
  "connections": {
    "Webhook": { "main": [ [ { "node": "Extract from File", "type": "main", "index": 0 } ] ] },
    "Extract from File": {
      "main": [
        [ { "node": "Has Text Layer?", "type": "main", "index": 0 } ],
        [ { "node": "Build Error Response", "type": "main", "index": 0 } ]
      ]
    },
    "Has Text Layer?": {
      "main": [
        [ { "node": "Extract Formula (OpenAI)", "type": "main", "index": 0 } ],
        [ { "node": "Build Error Response", "type": "main", "index": 0 } ]
      ]
    },
    "OpenAI Chat Model": { "ai_languageModel": [ [ { "node": "Extract Formula (OpenAI)", "type": "ai_languageModel", "index": 0 } ] ] },
    "Extract Formula (OpenAI)": { "main": [ [ { "node": "Normalize Response", "type": "main", "index": 0 } ] ] },
    "Normalize Response": { "main": [ [ { "node": "Respond to Webhook", "type": "main", "index": 0 } ] ] },
    "Build Error Response": { "main": [ [ { "node": "Respond to Webhook", "type": "main", "index": 0 } ] ] }
  },
  "settings": { "executionOrder": "v1", "executionTimeout": 120 },
  "pinData": {},
  "meta": {
    "instanceId": "astoria-formula-ocr-template",
    "templateCredsSetupCompleted": false
  },
  "tags": []
}
```

Notes for the implementer (do not put these in the JSON):
- `Extract from File` with `operation: "pdf"` requires n8n ≥ 1.44; LangChain nodes require `@n8n/n8n-nodes-langchain` installed on the host.
- Credentials are intentionally absent: at import time n8n links the node stubs to the credentials the user selects ("Astoria OCR Token" Header Auth and the OpenAI account). This is normal for exported templates.
- The IF node's error output is index 1; the Extract node's error output is index 1 — both land on `Build Error Response`, and the single `Respond to Webhook` node serves all three upstream branches.

- [ ] **Step 2: Validate the JSON and the Code-node scripts**

Run:
```bash
node -e "const w=require('./integrations/n8n/formula-ocr.workflow.json'); const names=w.nodes.map(n=>n.name); const want=['Webhook','Extract from File','Has Text Layer?','Extract Formula (OpenAI)','OpenAI Chat Model','Normalize Response','Build Error Response','Respond to Webhook']; for (const x of want) if (!names.includes(x)) throw new Error('missing node '+x); for (const [src,o] of Object.entries(w.connections)) for (const arr of Object.values(o)) for (const branch of arr) for (const c of branch) if (!names.includes(c.node)) throw new Error('dangling connection '+src+' -> '+c.node); console.log('workflow JSON OK:', w.nodes.length, 'nodes');"
```
Expected: `workflow JSON OK: 8 nodes`

Then smoke-test both jsCode bodies with stubbed n8n globals:
```bash
node --input-type=commonjs <<'EOF'
const w = require("./integrations/n8n/formula-ocr.workflow.json");
const code = (name) => w.nodes.find(n => n.name === name).parameters.jsCode;

function runJsCode(js, input, dollar) {
  const $input = { all: () => input };
  const fn = new Function("$input", "$", js);
  return fn($input, dollar);
}
const dollar = () => ({ first: () => ({ binary: { file: { fileName: "MR03-BN-01.pdf" } } }) });

/* good path: fenced JSON from the LLM */
const good = runJsCode(code("Normalize Response"), [{ json: { text: "```json\n{\"ffs\":\"MR03-BN-01\",\"kategori\":\"Cream\",\"customer\":\"PT ABC Beauty\",\"bj\":\"1.02\",\"phMin\":5.2,\"phMax\":5.8,\"viscosity\":\"20000 - 30000 cP\",\"stabTk\":\"pass\",\"stabTkul\":\"Pass\",\"stabT50\":\"Running\",\"stabTm\":\"n/a\",\"note\":\"\",\"lines\":[{\"materialName\":\"Aqua\",\"materialCode\":\"\",\"pct\":62.5,\"note\":\"\"},{\"materialName\":\"Glycerin\",\"materialCode\":\"RM-1001\",\"pct\":37.5,\"note\":\"\"}]}\n```" } }], dollar);
const r = good[0].json;
if (r.ok !== true) throw new Error("good path not ok");
if (r.formula.bj !== 1.02 || r.formula.stabTk !== "Pass" || r.formula.stabTm !== "-") throw new Error("normalize wrong: " + JSON.stringify(r.formula));
if (r.document.fileName !== "MR03-BN-01.pdf") throw new Error("fileName wrong");
if (!r.warnings.some(w => w.includes("Stability TM"))) throw new Error("missing stab warning");
console.log("Normalize Response smoke OK");

/* bad path: non-JSON LLM output */
const bad = runJsCode(code("Normalize Response"), [{ json: { text: "sorry, I cannot parse that" } }], dollar);
if (bad[0].json.ok !== false) throw new Error("bad path should be ok:false");
console.log("Normalize bad-JSON OK");

/* error builder: scanned PDF branch */
const e1 = runJsCode(code("Build Error Response"), [{ json: {} }], dollar);
if (!String(e1[0].json.error).includes("scanned PDF")) throw new Error("scanned branch wrong");
const e2 = runJsCode(code("Build Error Response"), [{ json: { error: { message: "bad xref" } } }], dollar);
if (!String(e2[0].json.error).includes("bad xref")) throw new Error("read-error branch wrong");
console.log("Build Error Response smoke OK");
EOF
```
Expected: four `... OK` lines, no exceptions.

- [ ] **Step 3: Write the setup guide**

Create `integrations/n8n/README.md`:

````markdown
# Astoria Formula OCR — n8n workflow

Self-hosted n8n workflow that turns a digitally-exported Formula PDF into JSON for the
Master Formula import in the F/G web app. Text extraction only — scanned PDFs are rejected
with a clear message (see "Limitations").

## Requirements

- n8n ≥ 1.44 (Extract from File / PDF) with the LangChain nodes package
  (`@n8n/n8n-nodes-langchain`) installed on the host.
- An OpenAI API key with access to `gpt-4o-mini`.
- A public HTTPS URL for the n8n instance (the browser calls it cross-origin).

## Setup

1. **Import** `formula-ocr.workflow.json` into n8n (Workflows → Import from File).
2. **Header Auth credential** — Credentials → New → "Header Auth", name it
   `Astoria OCR Token`, configure:
   - Header Name: `X-Astoria-Token`
   - Header Value: a long random string (this is your shared token).
   Then open the imported **Webhook** node and select this credential.
3. **OpenAI credential** — on the **OpenAI Chat Model** node, select your OpenAI account
   (model is fixed to `gpt-4o-mini`, temperature 0).
4. **CORS** — the Webhook node ships with `allowedOrigins: "*"`. For production, set it to
   the app's exact origin (e.g. `https://fg.astoria.example`).
5. **Activate** the workflow. The production URL is then
   `https://<your-n8n-host>/webhook/astoria/formula-ocr`.
6. **Configure the app** — in `assets/js/supabase-config.js` fill:
   ```js
   window.ASTORIA_OCR = {
     webhookUrl: "https://<your-n8n-host>/webhook/astoria/formula-ocr",
     token: "<the Header Value from step 2>"
   };
   ```
   The "Import from PDF" button on the Master Formula page appears only when both values are set.

## Test with curl

```bash
curl -X POST "https://<your-n8n-host>/webhook/astoria/formula-ocr" \
  -H "X-Astoria-Token: <token>" \
  -F "file=@sample-formula.pdf"
```

Success: HTTP 200 with `{"ok":true,"document":{...},"formula":{...},"warnings":[...]}`.
Scanned PDF: HTTP 200 with `{"ok":false,"error":"This looks like a scanned PDF ..."}`.
Every response is HTTP 200 — check the `ok` flag, not the status code.

## Changing the captured fields

The RND field set is provisional. To add/remove a captured field, edit **only** the prompt in
the *Extract Formula (OpenAI)* node (and, if the shape changes, the *Normalize Response* code
node). The web app ignores unknown keys and fills missing ones with warnings, so no app
change is required for additive field changes.

## Limitations

- **Digital PDFs only.** The workflow extracts the PDF text layer; there is no vision fallback.
  Ask R&D to export the Word document with "Save as PDF" (not a scan/photo).
- Request limits: `.pdf` only, ≤ 10 MB, 120 s workflow timeout (matches the app's client abort).
- The app must be served over HTTP(S). Opening it as `file://` makes the browser block this
  cross-origin call.
- The `X-Astoria-Token` is embedded in the web app and visible to any signed-in employee.
  Abuse costs only OpenAI credits; rotate the token if it leaks.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App toast "Could not reach the n8n webhook" | instance down / URL typo / CORS | check URL, workflow active, `allowedOrigins` |
| `{"ok":false,"error":"This looks like a scanned PDF ..."}` | PDF has no text layer | re-export digitally |
| `{"ok":false,"error":"Could not read the PDF: ..."}` | corrupt/encrypted PDF | open the PDF, re-export |
| `{"ok":false,"error":"OpenAI did not return valid JSON ..."}` | model drifted from schema | retry; if persistent, tighten the prompt |
````

- [ ] **Step 4: Re-run validation after any edit**

Run the two commands from Step 2 again; both must still pass.

- [ ] **Step 5: Commit**

```bash
git add integrations/n8n/formula-ocr.workflow.json integrations/n8n/README.md
git commit -m "n8n template: formula PDF OCR workflow + setup guide"
```

---

### Task 4: App wiring — button, spinner, prefilled editor, IMPORT audit

**Files:**
- Modify: `assets/js/views-master.js` (3 regions, see anchors)
- Modify: `assets/js/supabase-config.js` (append config block)
- Modify: `assets/css/app.css` (append spinner + banner styles)
- Modify: `index.html` (script tag + version bump)

**Interfaces:**
- Consumes: `OCRImport.configured()`, `OCRImport.parsePdf(file)`, `OCRImport.mapToFormulaDraft(payload, Store.get())` from Tasks 1–2.
- Produces: user-facing flow. Nothing downstream consumes code from this task.

- [ ] **Step 1: Add the config block**

In `assets/js/supabase-config.js`, append after the existing `window.ASTORIA_SUPABASE` block:

```js
/* Formula PDF import (n8n + OpenAI). Fill both values after importing
   integrations/n8n/formula-ocr.workflow.json - see that folder's README.
   When either value is empty the "Import from PDF" button stays hidden.
   The token is client-visible by design (internal tool; rotate if leaked). */
window.ASTORIA_OCR = {
  webhookUrl: "",   /* e.g. https://<n8n-host>/webhook/astoria/formula-ocr */
  token: ""         /* X-Astoria-Token Header Auth value */
};
```

- [ ] **Step 2: Add CSS**

Append to `assets/css/app.css`:

```css
/* OCR import - spinner modal + amber warning banner */
.spinner {
  width: 28px; height: 28px; margin: 0 auto;
  border: 3px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.import-banner {
  background: var(--amber-soft);
  border: 1px solid #e8cf9a;
  color: var(--amber);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  margin-bottom: 10px;
}
.import-banner ul { margin: 6px 0 0; padding-left: 18px; }
```

- [ ] **Step 3: Wire the formula page (views-master.js)**

Region (a) — `formulas()` toolbar. Current code at ~line 885:

```js
  function formulas(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("formulas");
    root.appendChild(UI.pageHead("Master Formula (FFS)",
      "Bulk formula parameters (form RM-RD-09): specific gravity, pH range, viscosity and the TK / TKUL / T50 / TM stability tests. Maintained by RND Formula; the recipe percentages are entered on each production BOM.",
      canEdit ? [UI.btn("+ New Formula", function () { formulaEditor(null); }, "btn-primary")] : []));
```

Replace with:

```js
  function formulas(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditMaster("formulas");
    var headBtns = [];
    if (canEdit && window.OCRImport && OCRImport.configured()) {
      headBtns.push(UI.btn("Import from PDF", importFormulaPdf, ""));
    }
    if (canEdit) headBtns.push(UI.btn("+ New Formula", function () { formulaEditor(null); }, "btn-primary"));
    root.appendChild(UI.pageHead("Master Formula (FFS)",
      "Bulk formula parameters (form RM-RD-09): specific gravity, pH range, viscosity and the TK / TKUL / T50 / TM stability tests. Maintained by RND Formula; the recipe percentages are entered on each production BOM.",
      headBtns));
```

Region (b) — insert the import flow right **before** `function formulaEditor(rec) {` (do this edit while the signature is still the original one — region (c) renames it):

```js
  /* ------------------------------------------------------------------
     Import from PDF (n8n webhook -> OpenAI -> prefilled editor).
     Visible only when window.ASTORIA_OCR is configured AND the user
     may edit Master Formula.
     ------------------------------------------------------------------ */
  function importFormulaPdf() {
    var inp = UI.el("input", { type: "file", accept: ".pdf,application/pdf", style: "display:none" });
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) {
        var f = inp.files[0];
        inp.remove();
        runFormulaOcr(f);
      } else {
        inp.remove();
      }
    });
    inp.click();
  }

  function runFormulaOcr(file) {
    var sp = UI.el("div", { class: "spinner" });
    var sub = UI.el("p", { style: "margin:8px 0 0;font-size:12px;color:var(--muted);text-align:center" },
      ["Parsing " + file.name + " with n8n\u2026 usually 10\u201330 s"]);
    var box = UI.el("div", { style: "padding:8px 0" }, [sp, sub]);
    UI.modal({ title: "Import formula from PDF", body: box, actions: [], wide: false });
    var t0 = Date.now();
    var timer = setInterval(function () {
      sub.textContent = "Parsing " + file.name + " with n8n\u2026 " + Math.round((Date.now() - t0) / 1000) + " s (limit 120 s)";
    }, 1000);
    function done() { clearInterval(timer); UI.closeModal(); }
    OCRImport.parsePdf(file).then(function (payload) {
      var res = OCRImport.mapToFormulaDraft(payload, Store.get());
      done();
      formulaEditor(res.existing, {
        importInfo: {
          fileName: (payload.document && payload.document.fileName) || file.name,
          warnings: res.warnings
        },
        importData: res.draft
      });
    }, function (err) {
      done();
      UI.toast((err && err.message) || "Import failed", "err");
    });
  }

  function importBanner(info, existingRec) {
    var list = [UI.el("div", {}, ["Imported from " + info.fileName + " \u2014 check every value before saving."])];
    if (existingRec) {
      list.push(UI.el("div", {}, ["Formula " + existingRec.id + " already exists \u2014 saving will overwrite its parameters and composition."]));
    }
    if (info.warnings && info.warnings.length) {
      list.push(UI.el("ul", {}, info.warnings.map(function (w) { return UI.el("li", {}, [w]); })));
    }
    return UI.el("div", { class: "import-banner" }, list);
  }
```

Region (c) — `formulaEditor` signature + prefill + title + banner + audit. Current top (~line 943):

```js
  function formulaEditor(rec) {
    if (!RBAC.canEditMaster("formulas")) { UI.toast("Formula master is read-only for your role", "err"); return; }
    var isNew = !rec;
    var d = Object.assign({ id: "", kategori: "", customerId: "", urutan: 0, bj: 1, phMin: "", phMax: "",
      viscosity: "", stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-", note: "", lines: [] }, rec || {});
    if (!d.lines) d.lines = [];
```

Replace with (note `opts` and the prefill override — the parsed draft wins over an existing record; the banner tells the user):

```js
  function formulaEditor(rec, opts) {
    if (!RBAC.canEditMaster("formulas")) { UI.toast("Formula master is read-only for your role", "err"); return; }
    opts = opts || {};
    var isNew = !rec;
    var d = Object.assign({ id: "", kategori: "", customerId: "", urutan: 0, bj: 1, phMin: "", phMax: "",
      viscosity: "", stabTk: "-", stabTkul: "-", stabT50: "-", stabTm: "-", note: "", lines: [] }, rec || {});
    if (!d.lines) d.lines = [];
    if (opts.importData) {
      Object.keys(opts.importData).forEach(function (k) {
        if (opts.importData[k] !== undefined) d[k] = opts.importData[k];
      });
      d.lines = (opts.importData.lines || []).map(function (l) { return Object.assign({}, l); });
    }
```

Title line (~1052) — current:

```js
      title: isNew ? "New Formula (FFS)" : "Edit Formula - " + rec.id,
```

Replace with:

```js
      title: (isNew ? "New Formula (FFS)" : "Edit Formula - " + rec.id) + (opts.importInfo ? " (imported)" : ""),
```

Banner insertion — the body element opens at line 1030 with `var body = UI.el("div", {}, [` and its array closes at line 1051 with:

```js
      fieldset("Material Composition", [compWrap])
    ]);
```

Insert one line immediately after that `]);`:

```js
    if (opts.importInfo) body.insertBefore(importBanner(opts.importInfo, rec), body.firstChild);
```

(Do not rewrite the big body array — inserting this single line after the `]);` is the whole change.)

Save tail — current (inside the Save Formula onClick, 10-space indent):

```js
          /* clean lines: remove empty material rows */
          d.lines = d.lines.filter(function (l) { return l.materialCode; });
          Store.saveFormula(d, isNew, rec ? rec.id : null);
          UI.closeModal(); App.refresh();
          UI.toast("Formula " + d.id + " saved", "ok");
```

Replace with:

```js
          /* clean lines: remove empty material rows */
          d.lines = d.lines.filter(function (l) { return l.materialCode; });
          Store.saveFormula(d, isNew, rec ? rec.id : null);
          if (opts.importInfo) {
            Store.audit("IMPORT", "Master Formula", d.id + " confirmed from " + opts.importInfo.fileName);
          }
          UI.closeModal(); App.refresh();
          UI.toast("Formula " + d.id + " saved", "ok");
```

- [ ] **Step 4: index.html — script tag + version bump**

Insert after the `supabase-config.js` line:

```html
<script src="assets/js/ocr-import.js?v=30"></script>
```

Then bump **every** `?v=29` in `index.html` to `?v=30` (this includes the css link and all script tags — they always move together).

Verify: `grep -o "?v=30" index.html | wc -l` → `24` (23 existing tags + the new script).
And: `grep -c "?v=29" index.html` → `0`.

- [ ] **Step 5: Syntax-check the touched JS**

Run:
```bash
node -e "global.window={}; require('./assets/js/ocr-import.js'); global.window={}; require('./assets/js/supabase-config.js'); console.log('modules load OK')"
node --check assets/js/views-master.js && echo "views-master.js syntax OK"
node tests/ocr-import.test.js
```
Expected: `modules load OK`, `views-master.js syntax OK`, `RESULT: ALL PASS`.

- [ ] **Step 6: Manual browser verification**

Serve the app (do not use `file://`): from the repo root run `python -m http.server 8000` (or `npx http-server -p 8000`) and open `http://localhost:8000`. Sign in with an admin account.

1. With `window.ASTORIA_OCR` empty → Master Formula shows only "+ New Formula".
2. In the console: `window.ASTORIA_OCR = { webhookUrl: "https://example.invalid/webhook/x", token: "test" }; App.refresh();` → "Import from PDF" appears. (A full page reload returns to hidden — config comes from `supabase-config.js`.)
3. Prefill path — stub the network in the console:
   ```js
   OCRImport.parsePdf = function () {
     return Promise.resolve({
       ok: true,
       document: { fileName: "MR03-BN-01.pdf", parser: "openai" },
       formula: { ffs: "MR03-BN-01", kategori: "Cream", customer: "Bening Naturals", bj: 1.02, phMin: 5.2, phMax: 5.8, viscosity: "20000 - 30000 cP", stabTk: "Pass", stabTkul: "Pass", stabT50: "Running", stabTm: "-", note: "", lines: [ { materialName: "", materialCode: "", pct: 62.5, note: "" }, { materialName: "", materialCode: "", pct: 37.5, note: "" } ] },
       warnings: ["BJ read from table caption"]
     });
   };
   ```
   Click Import from PDF, pick any small `.pdf` → spinner modal shows elapsed seconds → editor opens titled "… (imported)" with the amber banner (file name, warnings, the two unmatched-material warnings), fields prefilled, Σ indicator live. Fix the two lines to real materials, press Save → toast "Formula MR03-BN-01 saved".
4. Audit check — since MR03-BN-01 already existed in this scenario, the banner also shows the overwrite warning in step 3. After saving, open the Audit Log view (Control group in the sidenav) and confirm both the UPDATE row and the `IMPORT — Master Formula — MR03-BN-01 confirmed from MR03-BN-01.pdf` row exist.
5. Failure path — `OCRImport.parsePdf = function () { return Promise.reject(new Error("Timed out waiting for the n8n webhook - try again or enter the formula manually")); };` → click Import, pick a file → spinner closes, red toast with that message.
6. Reload the page → button hidden again (config empty in file).

- [ ] **Step 7: Commit**

```bash
git add assets/js/views-master.js assets/js/supabase-config.js assets/css/app.css index.html
git commit -m "Master Formula: Import from PDF via n8n (prefilled editor + IMPORT audit)"
```

---

## Follow-ups (not part of this plan's tasks)

- **RND field-set finalization (2026-10-01 meeting):** if the captured fields change, edit the prompt in the n8n *Extract Formula (OpenAI)* node (and *Normalize Response* if the shape moves); the browser mapping tolerates additive changes, so only extend `mapToFormulaDraft` if a new field must land in `m_formula`.
- **Deploy n8n** on the client host, import the workflow, then paste the production URL + token into `assets/js/supabase-config.js` (`window.ASTORIA_OCR`).
- **Set `allowedOrigins`** on the Webhook node to the production app origin (ships as `*`).
- **Real-document E2E**: run one actual R&D Formula PDF through the deployed workflow and confirm all fields land correctly.
