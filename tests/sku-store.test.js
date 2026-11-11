/* Run: node tests/sku-store.test.js */
"use strict";
global.window = global;
var _ls = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function (k, v) { _ls[k] = String(v); },
  removeItem: function (k) { delete _ls[k]; }
};
global.document = { createElement: function () { return { style: {}, setAttribute: function () {}, click: function () {}, remove: function () {} }; }, body: { appendChild: function () {} } };
require("../assets/js/seed.js");
require("../assets/js/engine.js");
require("../assets/js/netting.js");
require("../assets/js/store.js");
require("../assets/js/rbac.js");
var Store = window.Store, Engine = window.Engine;
var fails = 0, count = 0;
function eq(name, got, want) {
  count++;
  var ok = (typeof want === "number") ? Math.abs(Number(got) - want) < 1e-6 : got === want;
  if (!ok) { fails++; console.log("FAIL " + name + "  got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)); }
  else console.log("PASS " + name);
}
function ok(name, cond) { eq(name, !!cond, true); }
Store.load();
Store.setUser({ name: "T", email: "t@x", role: "Admin" });

/* brands CRUD */
Store.saveBrand({ id: "BRL", name: "B Erl", customerId: "" }, true, null);
eq("brand saved", Store.brandById("BRL").name, "B Erl");
Store.saveBrand({ id: "BRL", name: "B Erl Cosmetics", customerId: "" }, false, "BRL");
eq("brand updated", Store.brandById("BRL").name, "B Erl Cosmetics");

/* masters for the new-scheme FG */
Store.saveFormula({ id: "F1", kategori: "Eye Makeup", dosageForm: "CP", customerId: "", bj: 1, lines: [] }, true, null);
Store.saveFormula({ id: "F2", kategori: "Skincare", dosageForm: "LQ", customerId: "", bj: 1, lines: [] }, true, null);
Store.savePackaging({ id: "P1", volumeMl: 10, revisi: 1, lines: [] }, true, null);
Store.savePackaging({ id: "P2", volumeMl: 10, revisi: 2, lines: [] }, true, null);
Store.savePackaging({ id: "P3", volumeMl: 20, revisi: 1, lines: [] }, true, null);

/* new-scheme save */
var rec = { brandId: "BRL", formulaId: "F1", packagingId: "P1", deskripsi: "Test compact", kodeNA: "", tglExpire: "", discontinue: false };
var s = { app: Engine.appOf("Eye Makeup"), form: "CP" };
rec.app = s.app; rec.form = s.form;
rec.seq = Engine.seqFor(Store.get().fgs, "BRL", s.app, s.form, "F1");
rec.sizeLetter = Engine.sizeFor(Store.get().fgs, "BRL", s.app, s.form, rec.seq, 10);
rec.nettoMl = 10; rec.rev = 1;
Store.saveFG(rec, true, null);
eq("new id is code", rec.id, "BRLEYCP001A01");
eq("kodeFG stored", rec.kodeFG, "BRLEYCP001A01");
eq("status pending BPOM", rec.status, "Pending BPOM");

/* size variant: same formula, new netto */
var rec2 = { brandId: "BRL", formulaId: "F1", packagingId: "P3", deskripsi: "Test compact 20", kodeNA: "", tglExpire: "", discontinue: false, app: "EY", form: "CP" };
rec2.seq = Engine.seqFor(Store.get().fgs, "BRL", "EY", "CP", "F1");
rec2.sizeLetter = Engine.sizeFor(Store.get().fgs, "BRL", "EY", "CP", rec2.seq, 20);
rec2.nettoMl = 20; rec2.rev = 1;
Store.saveFG(rec2, true, null);
eq("size variant seq reused", rec2.seq, 1);
eq("size variant letter B", rec2.id, "BRLEYCP001B01");

/* packaging revision */
var rev = Store.revisePackagingFG(rec.id, "P2");
ok("pack rev created", rev && rev.id === "BRLEYCP001A02");
eq("old discontinued", Store.fgById(rec.id).discontinue, true);
eq("rev NA cleared", rev.kodeNA, "");
eq("rev status pending", rev.status, "Pending BPOM");
var badNetto = Store.revisePackagingFG(rec2.id, "P1");
eq("netto mismatch blocked", badNetto && badNetto.error, "netto");
var badRev = Store.revisePackagingFG(rev.id, "P1");
eq("lower rev blocked", badRev && badRev.error, "rev");

/* formula revision */
Store.saveFormula({ id: "F1b", kategori: "Eye Makeup", dosageForm: "CP", customerId: "", bj: 1, lines: [] }, true, null);
var fr = Store.reviseFormulaFG(rev.id, "F1b");
ok("formula rev same code", fr && fr.id === rev.id);
eq("formula rev link swapped", fr.formulaId, "F1b");
var badCat = Store.reviseFormulaFG(rev.id, "F2");
eq("category change blocked", badCat && badCat.error, "category");

/* legacy parity + recode */
var leg = { ffs: "XX01", fps: "999", deskripsi: "legacy", kodeNA: "NA1", tglExpire: "2030-01-01", discontinue: false };
Store.saveFG(leg, true, null);
eq("legacy id pipe", leg.id, "XX01|999");
eq("legacy kode", leg.kodeFG, "XX01-999");
eq("legacy status aktif", leg.status, "Aktif");
var rc = Store.recodeFG(leg.id, { brand: "BRL", formulaId: "F2", packagingId: "P1", app: "SK", form: "LQ", seq: 1, size: "A", netto: 10, rev: 1 });
ok("recode kept id", rc && rc.id === "XX01|999");
eq("recode legacy alias", rc.legacyCode, "XX01-999");
eq("recode new code", rc.kodeFG, "BRLSKLQ001A01");
eq("recode status kept aktif", rc.status, "Aktif");
console.log(fails ? fails + " FAILURES of " + count : "ALL " + count + " PASS");
process.exit(fails ? 1 : 0);