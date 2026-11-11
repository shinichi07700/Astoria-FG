/* Run: node tests/sku-code.test.js */
global.window = {};
require("../assets/js/engine.js");
var E = window.Engine;
var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = (typeof want === "number") ? Math.abs(Number(got) - want) < 1e-6 : got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}
eq("skuCode diagram example", E.skuCode({ brand: "BRL", app: "EY", form: "CP", seq: 12, size: "A", rev: 1 }), "BRLEYCP012A01");
eq("valid example", E.validSkuCode("BRLEYCP012A01"), true);
eq("reject lowercase", E.validSkuCode("brleycp012a01"), false);
eq("reject bad app", E.validSkuCode("BRLXXCP012A01"), false);
eq("reject bad form", E.validSkuCode("BRLEYXX012A01"), false);
eq("reject short seq", E.validSkuCode("BRLEYCP12A01"), false);
eq("reject 3-digit rev", E.validSkuCode("BRLEYCP012A001"), false);
eq("appOf skincare", E.appOf("Skincare"), "SK");
eq("appOf cleansers", E.appOf("Cleansers & Makeup Removers"), "CL");
eq("appOf unknown", E.appOf("Nope"), "");
eq("dosage forms count", E.DOSAGE_FORMS.length, 7);

var rows = [
  { brandId: "BRL", app: "EY", form: "CP", formulaId: "F1", seq: 12, sizeLetter: "A", nettoMl: 10 },
  { brandId: "BRL", app: "EY", form: "CP", formulaId: "F2", seq: 13, sizeLetter: "A", nettoMl: 5 }
];
eq("seq reuse same formula", E.seqFor(rows, "BRL", "EY", "CP", "F1"), 12);
eq("seq next new formula", E.seqFor(rows, "BRL", "EY", "CP", "F3"), 14);
eq("seq first in group", E.seqFor(rows, "BRL", "SK", "LQ", "F9"), 1);
eq("size reuse same netto", E.sizeFor(rows, "BRL", "EY", "CP", 12, 10), "A");
eq("size next new netto", E.sizeFor(rows, "BRL", "EY", "CP", 12, 20), "B");
var full = [];
for (var i = 0; i < 26; i++) full.push({ brandId: "B", app: "EY", form: "CP", formulaId: "F", seq: 1, sizeLetter: String.fromCharCode(65 + i), nettoMl: i });
eq("size overflow empty", E.sizeFor(full, "B", "EY", "CP", 1, 99), "");
var seqFull = [{ brandId: "B", app: "EY", form: "CP", formulaId: "F", seq: 999, sizeLetter: "A", nettoMl: 1 }];
eq("seq overflow zero", E.seqFor(seqFull, "B", "EY", "CP", "G"), 0);
/* status evaluator is link-agnostic: same strings, same verdicts */
eq("status pending", E.evaluateStatus("F1", "P1", "", "", false), "Pending BPOM");
eq("status aktif", E.evaluateStatus("F1", "P1", "NA1", "2030-01-01", false), "Aktif");
eq("status discontinue", E.evaluateStatus("F1", "P1", "NA1", "2030-01-01", true), "Non Aktif");
eq("status missing fps nonaktif", E.evaluateStatus("F1", "", "NA1", "2030-01-01", false), "Non Aktif");
console.log(fails ? fails + " FAILURES of " + count : "ALL " + count + " PASS");
process.exit(fails ? 1 : 0);