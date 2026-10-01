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
