/* ============================================================
   Headless end-to-end test for the demo pipeline seed.
   Run: node tests/demo-seed.test.js   (exits non-zero on failure)

   Loads the real browser IIFE modules under a minimal window /
   localStorage shim (window === global so the cross-file bare
   references resolve), runs DemoSeed.build() as Admin, then drives
   the two actions the demo deliberately stops short of - the live
   FG receipt (FR-PR-02) and the Surat Jalan (create + close) - and
   asserts the whole chain lands where the UI guards expect it.
   No external dependencies, no browser, no Supabase.
   ============================================================ */
"use strict";
global.window = global;                     /* files assign window.X and reference each other bare */
var _ls = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; }
};
global.document = { createElement: function () { return { style: {}, setAttribute: function () {}, click: function () {}, remove: function () {} }; }, body: { appendChild: function () {} } };

/* load order mirrors index.html (deps before dependents) */
require("../assets/js/seed.js");
require("../assets/js/engine.js");
require("../assets/js/netting.js");
require("../assets/js/store.js");
require("../assets/js/rbac.js");
require("../assets/js/demo-seed.js");

var Store = window.Store, Engine = window.Engine, RBAC = window.RBAC, DemoSeed = window.DemoSeed;

var fails = 0, count = 0;
function ok(name, cond) {
  count++;
  if (!cond) { fails++; console.log("FAIL " + name); } else console.log("PASS " + name);
}
function eq(name, got, want) {
  count++;
  var pass = (typeof want === "number") ? Math.abs(Number(got) - want) < 1e-6 : got === want;
  if (!pass) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}

/* ---------- boot ---------- */
Store.load();

/* regression: "Reset to sample data" must hand back a fully-normalized db.
   Seed.build() only carries the master sample, so without fixSeq()/fixArrays()
   the pipeline arrays and seq keys stay undefined and DemoSeed.build() (and the
   pipeline views) throw "Cannot read properties of undefined (reading 'length')".
   The browser E2E caught this on the reset -> load-demo path; keep it covered. */
Store.resetToSample();
var rdb = Store.get();
ok("resetToSample normalizes pipeline arrays",
  ["suppliers", "purchaseReqs", "purchaseOrders", "calloffs", "inventoryLots",
   "workOrdersBulk", "workOrdersPack", "releases", "fgReceipts", "deliveryOrders",
   "deliveryLines", "stagings", "lineClearances", "btipTransfers"].every(function (k) {
    return Array.isArray(rdb[k]);
  }));
ok("resetToSample normalizes seq keys",
  ["so", "po", "rcv", "wo", "sj", "fgr", "rel", "campaign"].every(function (k) {
    return rdb.meta.seq[k] != null;
  }));

/* ---------- acting user = Admin ---------- */
Store.setUser({ name: "Admin Demo", email: "admin@astoriaprima.co.id", role: "Admin" });
ok("acting user is Admin", RBAC.isAdmin());

/* ---------- build the demo pipeline ---------- */
var res = DemoSeed.build();
ok("build did not report already-loaded", !res.alreadyLoaded);
ok("build self-check ok", res.ok === true);

var db = Store.get();

/* masters */
eq("one demo customer", db.customers.filter(function (c) { return c.id === DemoSeed.CUST_ID; }).length, 1);
ok("three demo suppliers", db.suppliers.length >= 3);
var linkedMats = db.materials.filter(function (m) { return !!m.supplierId; });
ok("raw & related materials linked to a supplier (>=12)", linkedMats.length >= 12);
ok("every linked material resolves a supplier name",
  linkedMats.every(function (m) { return !!Store.supplierById(m.supplierId); }));

/* sales order */
var so = Store.soById(db.meta.demoSoId);
ok("SO exists", !!so);
eq("SO is Confirmed", so.status, "Confirmed");
eq("SO order qty", Number(so.orderQty), DemoSeed.ORDER_QTY);
eq("SO remaining = order qty (nothing delivered yet)", Store.soRemainingQty(so.id), DemoSeed.ORDER_QTY);

/* netting output */
var prs = db.purchaseReqs.filter(function (r) { return String(r.soId) === String(so.id); });
var cos = db.calloffs.filter(function (r) { return String(r.soId) === String(so.id); });
var bulks = db.workOrdersBulk.filter(function (w) { return String(w.soId) === String(so.id); });
ok("PR lines raised (Astoria shortfall)", prs.length >= 1);
ok("call-off lines raised (customer packaging)", cos.length >= 1);
eq("one bulk campaign batch (978.5 kg -> Himix 1000)", bulks.length, 1);
ok("every PR line carries a supplierId", prs.every(function (r) { return !!r.supplierId; }));

/* purchasing -> receiving -> QA release */
ok("purchase orders created", db.purchaseOrders.length >= 1);
ok("inventory lots received", db.inventoryLots.length >= 1);
ok("all demo lots QA-released", db.inventoryLots.every(function (l) { return l.status === "Released"; }));
ok("stock ledger has receipt + issue rows", db.inventoryTxns.length >= 1);

/* staging */
ok("staging lines dispensed", db.stagings.some(function (s) { return s.status === "Dispensed"; }));

/* bulk execution */
var bulk = bulks[0];
eq("bulk WO Done", bulk.status, "Done");
ok("FR-QA-21 clearance Passed", Store.clearancePassed(bulk.id, "FR-QA-21"));
ok("BMR phases recorded", Store.phasesFor(bulk.id).length >= 1);
ok("BTIP transfer Confirmed", db.btipTransfers.some(function (b) { return b.status === "Confirmed"; }));

/* packing + release (the demo's terminal state) */
var pack = Store.packWoById(db.meta.demoPackWoId);
ok("pack WO exists", !!pack);
eq("pack WO Done", pack.status, "Done");
ok("rendemen inside 95-100%", Number(pack.rendemenPct) >= 95 && Number(pack.rendemenPct) <= 100);
ok("FR-QA-22 clearance Passed", Store.clearancePassed(pack.id, "FR-QA-22"));
ok("release Approved (FR-QC-06)", Store.releaseApproved(pack.id));

/* the demo must stop exactly where the live UI guards expect */
var eligible = db.workOrdersPack.filter(function (p) { return p.status === "Done" && Store.releaseApproved(p.id); });
eq("exactly one FG-receipt-eligible pack WO", eligible.length, 1);
eq("no FG receipt yet (created live)", db.fgReceipts.length, 0);
eq("no Surat Jalan yet (created live)", db.deliveryOrders.length, 0);

/* ---------- LIVE action 1: FG receipt (FR-PR-02) ---------- */
var fgr = Store.createFgReceipt({ woPackId: pack.id, qty: null, batchLot: "", expiry: "", note: "E2E receipt" });
ok("FG receipt created without error", !fgr.error);
eq("FG receipt qty = pack actual yield", Number(fgr.receipt.qty), Number(pack.actualYield));
eq("FG stock on hand = receipt qty", Store.fgSoh(fgr.receipt.kodeFg), Number(pack.actualYield));
eq("pack WO no longer eligible once received",
  db.workOrdersPack.filter(function (p) { return p.status === "Done" && Store.releaseApproved(p.id) && !db.fgReceipts.some(function (r) { return String(r.woPackId) === String(p.id); }); }).length, 0);

/* ---------- LIVE action 2: Surat Jalan (create + close) ---------- */
var shipQty = Number(pack.actualYield);          /* ship the full produced yield (partial vs the 9,500 order) */
var sj = Store.createDeliveryOrder({ soId: so.id, qty: shipQty, vehicle: "B 1234 XYZ", driver: "E2E Driver", note: "E2E SJ" });
ok("Surat Jalan created without error", !sj.error);
eq("Surat Jalan Open", sj.do.status, "Open");
eq("Surat Jalan picked the full FG qty", Store.deliveryQty(sj.do.id), shipQty);
ok("Surat Jalan closed", Store.closeDeliveryOrder(sj.do.id) === true);
eq("FG stock drawn down to zero", Store.fgSoh(fgr.receipt.kodeFg), 0);
eq("SO remaining after partial delivery", Store.soRemainingQty(so.id), DemoSeed.ORDER_QTY - shipQty);
eq("SO stays Confirmed on a partial delivery", Store.soById(so.id).status, "Confirmed");

/* ---------- idempotency guard ---------- */
var res2 = DemoSeed.build();
ok("second build is refused (already loaded)", res2.alreadyLoaded === true);
eq("second build added no new sales order", Store.get().salesOrders.length, db.salesOrders.length);

console.log("");
console.log(fails ? "RESULT: " + fails + " FAILED (" + count + " checks)" : "RESULT: ALL PASS (" + count + " checks)");
process.exit(fails ? 1 : 0);
