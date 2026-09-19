/* ============================================================
   Golden-vector unit tests for the pure netting engine (D2 +
   plan test plan). Run: node tests/netting.test.js
   Exits non-zero on any failure. No external dependencies.
   ============================================================ */
global.window = {};                              /* netting.js assigns window.Netting at load */
var N = require("../assets/js/netting.js");

var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = (typeof want === "number")
    ? Math.abs(Number(got) - want) < 1e-6
    : got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}

/* ---------- 1. grossBulkKg = orderQty x netto x BJ x (1 + loss) ---------- */
eq("grossBulkKg basic", N.grossBulkKg(10000, 0.1, 0.95, 0.03), 978.5);   /* 1000 x .95 x 1.03 */
eq("grossBulkKg no loss", N.grossBulkKg(1000, 0.25, 1, 0), 250);
eq("grossBulkKg bj<=0 neutral", N.grossBulkKg(1000, 0.25, 0, 0), 250);    /* BJ 0 -> treated as 1 */
eq("grossBulkKg zero qty", N.grossBulkKg(0, 0.25, 1, 0.5), 0);

/* ---------- 2. formula explosion on the 100% basis scaled to bulk kg ---------- */
var f = N.explodeFormula(1000, [
  { materialCode: "RM1", pct: 60, lossPct: 0, supportedBy: "Astoria", soh: 250, allocated: 50, moq: 25, leadDays: 7 },
  { materialCode: "RM2", pct: 40, lossPct: 5, supportedBy: "Astoria", soh: 0, allocated: 0, moq: 0, leadDays: 0 }
]);
eq("formula line1 gross (60% of 1000)", f[0].gross, 600);
eq("formula line2 gross (40% x 1.05)", f[1].gross, 420);
eq("formula line1 available (soh-allocated)", f[0].available, 200);
eq("formula line1 net (600-200)", f[0].net, 400);
eq("formula line2 net (no stock)", f[1].net, 420);

/* ---------- 3. customer-supplied => SOH treated as 0, all net ---------- */
var fc = N.explodeFormula(500, [
  { materialCode: "CUST1", pct: 100, lossPct: 0, supportedBy: "Customer", soh: 9999, allocated: 0 }
]);
eq("customer available is 0", fc[0].available, 0);
eq("customer net = gross", fc[0].net, 500);
eq("customer flag set", fc[0].customer, true);

/* ---------- 4. packaging explosion = perUnit x qty x (1 + scrap) ---------- */
var p = N.explodePackaging(10000, [
  { materialCode: "PM1", qtyPerUnit: 1, scrapPct: 2, supportedBy: "Astoria", soh: 4000, allocated: 0, moq: 500 },
  { materialCode: "PM2", qtyPerUnit: 2, lossPct: 0, supportedBy: "Customer", soh: 0, allocated: 0, leadDays: 10 }
]);
eq("packaging PM1 gross (1 x 10000 x 1.02)", p[0].gross, 10200);
eq("packaging PM1 net (10200-4000)", p[0].net, 6200);
eq("packaging PM2 gross (2 x 10000, lossPct fallback)", p[1].gross, 20000);
eq("packaging PM2 net (customer)", p[1].net, 20000);

/* ---------- 5. MOQ round-up ---------- */
eq("moq 30->50 (moq 25)", N.roundUpToMoq(30, 25), 50);
eq("moq exact 50 stays 50", N.roundUpToMoq(50, 25), 50);
eq("moq 120->150 (moq 50)", N.roundUpToMoq(120, 50), 150);
eq("moq 0 returns net", N.roundUpToMoq(12.34, 0), 12.34);
eq("moq net<=0 returns 0", N.roundUpToMoq(0, 25), 0);

/* ---------- 6. required-by date math (delivery - lead time) ---------- */
eq("addDays -7 across month", N.addDays("2026-10-01", -7), "2026-09-24");
eq("addDays -1 month boundary", N.addDays("2026-03-01", -1), "2026-02-28");
eq("addDays -1 year boundary", N.addDays("2026-01-01", -1), "2025-12-31");
eq("addDays empty in -> empty", N.addDays("", -5), "");
eq("addDays +0 stable", N.addDays("2026-09-19", 0), "2026-09-19");

/* ---------- 7. mixer sizing: fewest batches, right-sized last batch ---------- */
var mix = [
  { id: "MX-HIMIX1000", name: "Himix 1,000 kg", vessel: "Himix", capacityKg: 1000, active: true },
  { id: "MX-DJK500", name: "DJK 500 kg", vessel: "Double jacket kettle", capacityKg: 500, active: true },
  { id: "MX-DJK200", name: "DJK 200 kg", vessel: "Double jacket kettle", capacityKg: 200, active: true }
];
var s1 = N.sizeMixers(2500, mix);
eq("2500kg -> 3 batches", s1.batchCount, 3);
eq("2500kg batch0 is Himix full", s1.batches[0].mixerId, "MX-HIMIX1000");
eq("2500kg batch0 plannedKg", s1.batches[0].plannedKg, 1000);
eq("2500kg last batch right-sized to DJK500", s1.batches[2].mixerId, "MX-DJK500");
eq("2500kg last batch plannedKg 500", s1.batches[2].plannedKg, 500);

var s2 = N.sizeMixers(1000, mix);
eq("1000kg -> 1 batch", s2.batchCount, 1);
eq("1000kg batch is Himix", s2.batches[0].mixerId, "MX-HIMIX1000");

var s3 = N.sizeMixers(150, mix);
eq("150kg -> 1 batch in smallest fitting (DJK200)", s3.batches[0].mixerId, "MX-DJK200");
eq("150kg plannedKg", s3.batches[0].plannedKg, 150);

var s4 = N.sizeMixers(300, mix);
eq("300kg -> DJK500 (200 too small)", s4.batches[0].mixerId, "MX-DJK500");

var mixInactive = [
  { id: "MX-HIMIX1000", capacityKg: 1000, active: true },
  { id: "MX-DJK500", capacityKg: 500, active: false },
  { id: "MX-DJK200", capacityKg: 200, active: true }
];
var s5 = N.sizeMixers(2500, mixInactive);
eq("inactive excluded -> still 3 batches", s5.batchCount, 3);
eq("inactive excluded -> remainder falls back to Himix", s5.batches[2].mixerId, "MX-HIMIX1000");
eq("zero kg -> no batches", N.sizeMixers(0, mix).batchCount, 0);
eq("no mixers -> no batches", N.sizeMixers(500, []).batchCount, 0);

/* ---------- 8. end-to-end plan integration ---------- */
var plan = N.plan({
  orderQty: 10000, nettoPerUnit: 0.1, bj: 0.95, lossFactor: 0.03, deliveryDate: "2026-10-01",
  formulaLines: [
    { materialCode: "RM1", name: "Water", unit: "kg", pct: 60, lossPct: 0, supportedBy: "Astoria", soh: 250, allocated: 50, moq: 25, leadDays: 7 },
    { materialCode: "RM2", name: "Oil", unit: "kg", pct: 40, lossPct: 5, supportedBy: "Astoria", soh: 0, allocated: 0, moq: 50, leadDays: 14 }
  ],
  packagingLines: [
    { materialCode: "PM1", name: "Bottle", unit: "pcs", qtyPerUnit: 1, scrapPct: 2, supportedBy: "Customer", soh: 0, allocated: 0, moq: 0, leadDays: 10 }
  ],
  mixers: mix
});
eq("plan grossBulkKg", plan.grossBulkKg, 978.5);
/* RM1: gross = 978.5 x .60 = 587.1 ; available 200 ; net 387.1 ; moq 25 -> ceil(387.1/25)=16 -> 400 */
var prRM1 = plan.prLines.filter(function (l) { return l.materialCode === "RM1"; })[0];
eq("plan PR RM1 net", prRM1.net, 387.1);
eq("plan PR RM1 orderQty (MOQ 25 -> 400)", prRM1.orderQty, 400);
eq("plan PR RM1 requiredBy (delivery - 7d)", prRM1.requiredBy, "2026-09-24");
/* PM1 is customer-supplied -> call-off, not PR */
eq("plan has 1 call-off (customer bottle)", plan.calloffLines.length, 1);
eq("plan call-off requiredBy (delivery - 10d)", plan.calloffLines[0].requiredBy, "2026-09-21");
eq("plan call-off qty = gross (10200)", plan.calloffLines[0].qty, 10200);
eq("plan customer item NOT in PR", plan.prLines.some(function (l) { return l.materialCode === "PM1"; }), false);
/* RM2 -> PR too (no stock): gross 978.5 x .40 x 1.05 = 411.0 (round4) ; moq 50 -> ceil(411/50)=9 ->450 */
var prRM2 = plan.prLines.filter(function (l) { return l.materialCode === "RM2"; })[0];
eq("plan PR RM2 orderQty (MOQ 50 -> 450)", prRM2.orderQty, 450);
eq("plan campaign batchCount (978.5kg -> 1 Himix batch)", plan.campaign.batchCount, 1);
eq("plan campaign batch mixer", plan.campaign.batches[0].mixerId, "MX-HIMIX1000");
eq("plan campaign batch plannedKg", plan.campaign.batches[0].plannedKg, 978.5);

console.log("\n" + (fails ? "RESULT: FAIL (" + fails + "/" + count + ")" : "RESULT: ALL PASS (" + count + " vectors)"));
process.exit(fails ? 1 : 0);
