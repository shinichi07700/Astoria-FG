/* ============================================================
   DEMO SEED - builds a fully-linked, end-to-end pipeline sample
   on top of the current dataset, from master data all the way to
   an APPROVED packing work order (FR-QC-06). It stops there on
   purpose so the FG receipt (FR-PR-02) and the Surat Jalan can be
   raised LIVE during a demo or an end-to-end test.

   Admin-only: the chain crosses every department's sign-off, and
   only the Admin role may walk all of the rbac.js state machines.

   The demo reuses the seeded Marieskinlian Glowing Skin Toner
   (Finish Good + BOM-0001 + materials + mixers) so the netting
   maths and the FG backflush are the real thing, not a toy. Every
   master it adds uses a fixed id, so a reset + reload stays clean.
   ============================================================ */
window.DemoSeed = (function () {

  /* ---- demo parameters (tuned so the chain stays small but real) ----
     9,500 pcs x 0.1 kg x BJ 1 x (1 + 3% loss) = 978.5 kg of bulk, which
     the mixer catalogue sizes into a single Himix-1000 batch. The seeded
     stock covers most raw material, so netting raises just three purchase
     lines (RM-1001, RM-1009 and the Astoria shrink sleeve) plus six
     customer call-offs for the branded packaging. */
  var DEMO_FG   = "TO01MR03|100200100";   /* Marieskinlian Glowing Skin Toner 100 ml */
  var CUST_ID   = "CUST-DEMO-MARIESKIN";
  var ORDER_QTY = 9500;      /* pcs */
  var NETTO     = 0.1;       /* kg per unit (100 ml toner) */
  var BJ        = 1;         /* BOM-0001 has no formula master -> neutral density */
  var LOSS      = 0.03;      /* 3% bulk process loss */
  var YIELD_PCS = 9310;      /* packed yield -> rendemen 98% (inside the 95-100% band) */
  var REJECTS   = 190;
  var BATCH_LOT = "BATCH-DEMO-001";

  var SUPPLIERS = [
    { id: "SUP-DEMO-CHEM",  name: "PT Chemindo Nusantara",        pic: "Andi",   contact: "021-555-0101 / andi@chemindo.co.id",  terms: "Net 30", address: "Kawasan Industri MM2100, Cikarang Barat, Bekasi" },
    { id: "SUP-DEMO-BASF",  name: "BASF South East Asia Pte Ltd", pic: "Wijaya", contact: "021-555-0202 / wijaya@basf-sea.com",   terms: "Net 45", address: "Menara BCA, Jl. MH Thamrin No.1, Jakarta Pusat" },
    { id: "SUP-DEMO-KEMAS", name: "PT Kemasindo Prima",           pic: "Sari",   contact: "021-555-0303 / sari@kemasindo.co.id", terms: "Net 30", address: "Jl. Raya Serpong KM 7, Tangerang Selatan" }
  ];

  /* Raw materials + Astoria-related packaging -> supplier, MOQ and lead
     time. Customer-supplied components (302000xx) are deliberately left
     unlinked: they arrive on a call-off, not a purchase order. */
  var MAT_ENRICH = {
    "RM-1001":  { sup: "SUP-DEMO-CHEM",  moq: 25,   lead: 7 },
    "RM-1002":  { sup: "SUP-DEMO-CHEM",  moq: 25,   lead: 7 },
    "RM-1003":  { sup: "SUP-DEMO-BASF",  moq: 5,    lead: 30 },
    "RM-1004":  { sup: "SUP-DEMO-CHEM",  moq: 25,   lead: 7 },
    "RM-1005":  { sup: "SUP-DEMO-BASF",  moq: 5,    lead: 30 },
    "RM-1006":  { sup: "SUP-DEMO-BASF",  moq: 1,    lead: 30 },
    "RM-1007":  { sup: "SUP-DEMO-BASF",  moq: 1,    lead: 30 },
    "RM-1008":  { sup: "SUP-DEMO-CHEM",  moq: 5,    lead: 7 },
    "RM-1009":  { sup: "SUP-DEMO-BASF",  moq: 5,    lead: 30 },
    "20200001": { sup: "SUP-DEMO-KEMAS", moq: 1000, lead: 14 },
    "20010004": { sup: "SUP-DEMO-KEMAS", moq: 100,  lead: 10 },
    "20010002": { sup: "SUP-DEMO-KEMAS", moq: 10,   lead: 10 }
  };

  /* Faithful copy of the PPIC view's BOM -> Netting.plan mapper, so the demo
     walks the exact same maths the live page does. A legacy BOM without a
     stored pct column falls back to the batch-weight ratio (BOM-0001 does). */
  function buildPlanInput(bom, inp) {
    var matMap = Store.matMap();
    function mi(code, unit) {
      var m = matMap[code] || {};
      return {
        name: m.name || ("(unknown " + code + ")"), unit: unit || m.unit || "",
        soh: Number(m.stockQty) || 0, allocated: Store.allocatedOf ? Store.allocatedOf(code) : 0,
        moq: Number(m.moq) || 0, leadDays: Number(m.leadDays) || 0
      };
    }
    var items = bom.items || [];
    var fItems = items.filter(function (it) { return it.section === "FORMULA"; });
    var kItems = items.filter(function (it) { return it.section === "KEMAS"; });
    var pctSum = fItems.reduce(function (a, it) { return a + (Number(it.pct) || 0); }, 0);
    var batchSum = fItems.reduce(function (a, it) { return a + (Number(it.qtyPerBatch) || 0); }, 0);
    var useStored = Math.abs(pctSum - 100) < 0.5;
    var formulaLines = fItems.map(function (it) {
      var info = mi(it.materialCode, it.unit);
      var pct = useStored ? (Number(it.pct) || 0)
        : (batchSum > 0 ? (Number(it.qtyPerBatch) || 0) / batchSum * 100 : 0);
      return {
        materialCode: it.materialCode, name: info.name, unit: info.unit || "kg",
        pct: pct, lossPct: Number(it.lossPct) || 0, supportedBy: it.supportedBy || "Astoria",
        soh: info.soh, allocated: info.allocated, moq: info.moq, leadDays: info.leadDays
      };
    });
    var packagingLines = kItems.map(function (it) {
      var info = mi(it.materialCode, it.unit);
      return {
        materialCode: it.materialCode, name: info.name, unit: info.unit || "pcs",
        qtyPerUnit: Number(it.qtyPerUnit) || 0, scrapPct: Number(it.lossPct) || 0,
        supportedBy: it.supportedBy || "Astoria",
        soh: info.soh, allocated: info.allocated, moq: info.moq, leadDays: info.leadDays
      };
    });
    return {
      orderQty: inp.orderQty, nettoPerUnit: inp.nettoPerUnit, bj: inp.bj, lossFactor: inp.lossFactor,
      deliveryDate: inp.deliveryDate, formulaLines: formulaLines, packagingLines: packagingLines,
      mixers: Store.get().mixers
    };
  }

  /* ---------------- the build ---------------- */
  function build() {
    var db = Store.get();
    if (!RBAC.isAdmin()) throw new Error("Load the demo pipeline as Admin - the chain signs off every department's state machine.");
    if (db.meta.demoLoaded) return { alreadyLoaded: true, message: "Demo pipeline is already loaded - use 'Reset to sample data' first, then reload it." };

    var fg = Store.fgById(DEMO_FG);
    var bom = Store.bomByFg(DEMO_FG);
    if (!fg || !bom) throw new Error("Demo product or its BOM is missing - 'Reset to sample data', then retry.");
    if (!db.mixers || !db.mixers.length) throw new Error("No mixers in the catalogue - the lot plan cannot be sized.");

    var today = Engine.todayISO();
    var delivery = Netting.addDays(today, 30);

    /* ---- 1. Master Customer ---- */
    var cust = {
      id: CUST_ID, name: "PT Marieskinlian Indonesia",
      address: "Jl. Gatot Subroto Kav. 31, Jakarta Selatan",
      pic: "Rina Marlina", contact: "021-555-0909 / rina@marieskinlian.co.id", terms: "Net 30"
    };
    Store.saveCustomer(cust, !Store.customerById(CUST_ID), CUST_ID);

    /* ---- 2. Master Suppliers + link the raw & related materials ---- */
    SUPPLIERS.forEach(function (s) { Store.saveSupplier(s, !Store.supplierById(s.id), s.id); });
    var mm = Store.matMap(), linked = 0;
    Object.keys(MAT_ENRICH).forEach(function (code) {
      var m = mm[code]; if (!m) return;
      var e = MAT_ENRICH[code];
      var sup = Store.supplierById(e.sup);
      var rec = Object.assign({}, m);
      rec.supplierId = e.sup;
      rec.supplier = sup ? sup.name : (m.supplier || "");
      rec.moq = Number(m.moq) || e.moq || 0;
      rec.leadDays = Number(m.leadDays) || e.lead || 0;
      Store.saveMaterial(rec, false, code);
      linked++;
    });

    /* ---- 3. Confirmed Sales Order (Marketing) ---- */
    var so = {
      id: Store.uid("SO"), noSo: Engine.noRequest("SO", Store.nextSeq("so"), today),
      customerId: CUST_ID, fgId: DEMO_FG, kodeBarang: "MSK-TONER-100ML",
      nettoPerUnit: NETTO, orderQty: ORDER_QTY, deliveryDate: delivery,
      status: "Draft", note: "Demo pipeline order", createdBy: "marketing@astoriaprima.co.id"
    };
    Store.saveSalesOrder(so, true, null);
    Store.transitionSO(so.id, "Confirmed");

    /* ---- 4. PPIC netting -> PR + call-off + campaign bulk batch ---- */
    var plan = Netting.plan(buildPlanInput(bom, {
      orderQty: ORDER_QTY, nettoPerUnit: NETTO, bj: BJ, lossFactor: LOSS, deliveryDate: delivery
    }));
    var ppic = Store.savePpicRun({
      soId: so.id, noSo: so.noSo, fgId: DEMO_FG, customerId: CUST_ID,
      bulkCode: bom.bulkCode || "", deliveryDate: delivery, date: today,
      prLines: plan.prLines, calloffLines: plan.calloffLines, batches: plan.campaign.batches
    });

    /* ---- 5. Purchase Orders, one per supplier (Purchasing) ---- */
    var openPrs = db.purchaseReqs.filter(function (r) { return String(r.soId) === String(so.id) && r.status === "Open"; });
    var bySup = {};
    openPrs.forEach(function (r) { var k = r.supplierId || "_none"; (bySup[k] = bySup[k] || []).push(r); });
    var poNos = [], poLines = 0;
    Object.keys(bySup).forEach(function (sid) {
      var prs = bySup[sid], sup = sid === "_none" ? null : Store.supplierById(sid);
      var prices = {};
      prs.forEach(function (r) { prices[r.id] = 0; });
      var res = Store.createPoFromPr(prs.map(function (r) { return r.id; }), {
        supplierId: sup ? sup.id : "", supplier: sup ? sup.name : "",
        eta: delivery, prices: prices, date: today, note: "Demo purchase order"
      });
      poNos.push(res.poNo); poLines += res.count;
    });

    /* ---- 6. Receive each PO line, then QA-release the lot ---- */
    var lots = 0;
    db.purchaseOrders.filter(function (p) { return poNos.indexOf(p.poNo) >= 0; }).forEach(function (po) {
      var lot = Store.receivePoLine(po.id, {
        qty: po.qty, lotNo: "LOT-" + po.materialCode + "-DEMO", receivedAt: today,
        coaRef: "COA-DEMO-" + po.materialCode, halalRef: "HALAL-DEMO", msdsRef: "MSDS-DEMO",
        expiry: Netting.addDays(today, 720), note: "Demo goods receipt"
      });
      if (lot) { Store.setLotStatus(lot.id, "Released"); lots++; }
    });

    /* ---- 7. Bulk mixing: clearance -> staging -> BMR phases -> BTIP ---- */
    var bulkWo = db.workOrdersBulk.filter(function (w) { return String(w.soId) === String(so.id); })[0];
    var staged = 0;
    if (bulkWo) {
      var lcBulk = Store.createLineClearance({
        clearanceType: "FR-QA-21", woType: "Bulk", woId: bulkWo.id, woRef: bulkWo.woNo,
        campaignNo: bulkWo.campaignNo, date: today, note: "Demo bulk line clearance",
        checklist: [
          { item: "Mixing line cleaned & cleared", ok: true, note: "" },
          { item: "No previous product or labels on the line", ok: true, note: "" },
          { item: "Weighing scale & homogenizer calibrated", ok: true, note: "" },
          { item: "BMR / formula sheet available", ok: true, note: "" }
        ]
      });
      Store.setClearanceStatus(lcBulk.id, "Passed");
      Store.transitionBulkWo(bulkWo.id, "Released");

      /* weigh & dispense the formula materials that have Released lots */
      var plannedKg = Number(bulkWo.plannedKg) || 0;
      var picks = [];
      plan.formula.forEach(function (l) {
        var req = Engine.round4(plannedKg * (Number(l.pct) || 0) / 100);
        if (req <= 0) return;
        Store.fifoPick(l.materialCode, req).picks.forEach(function (p) { picks.push(p); });
      });
      if (picks.length) {
        Store.createStaging({ date: today, docType: "FR-PP-01", woId: bulkWo.id, campaignNo: bulkWo.campaignNo, fgId: DEMO_FG, picks: picks });
        db.stagings.filter(function (s) { return String(s.woId) === String(bulkWo.id) && s.status === "Reserved"; })
          .forEach(function (s) { Store.dispenseStaging(s.id, "warehouse@astoriaprima.co.id"); staged++; });
      }

      Store.transitionBulkWo(bulkWo.id, "InProgress");

      /* two BMR phase rows, theoretical = actual (a clean demo run) */
      function pctOf(code) {
        var l = plan.formula.filter(function (x) { return x.materialCode === code; })[0];
        return l ? (Number(l.pct) || 0) : 0;
      }
      [{ no: 1, name: "Phase 1 - Demineralized water base", code: "RM-1001" },
       { no: 2, name: "Phase 2 - Actives, preservative & fragrance", code: "RM-1009" }].forEach(function (ph) {
        var theo = Engine.round4(plannedKg * pctOf(ph.code) / 100);
        Store.saveBulkPhase({
          id: Store.uid("PH"), woId: bulkWo.id, phaseNo: ph.no, phaseName: ph.name,
          materialCode: ph.code, materialName: (Store.matMap()[ph.code] || {}).name || "",
          theoreticalKg: theo, actualKg: theo, vessel: "Himix 1000", homogenizerHz: 35, temperatureC: 28,
          startedAt: Engine.nowWIB(), endedAt: Engine.nowWIB(), operator: "production@astoriaprima.co.id", note: "Demo BMR phase"
        }, true, null);
      });

      Store.transitionBulkWo(bulkWo.id, "Done");

      var btip = Store.createBtipTransfer({
        woId: bulkWo.id, campaignNo: bulkWo.campaignNo, fromVessel: "Himix 1000", toHopper: "Packing Hopper A",
        bulkCode: bom.bulkCode || "", qty: plannedKg, uom: "Kg",
        transferredBy: "production@astoriaprima.co.id", qaBy: "qa@astoriaprima.co.id", date: today, note: "Demo BTIP"
      });
      btip.status = "Confirmed";
      Store.saveBtipTransfer(btip, false, btip.id);
    }

    /* ---- 8. Packing: WO -> clearance -> yield -> Done ---- */
    var pack = Store.createPackWo({
      campaignNo: bulkWo ? bulkWo.campaignNo : "", soId: so.id, fgId: DEMO_FG,
      bulkWoId: bulkWo ? bulkWo.id : "", bulkCode: bom.bulkCode || "",
      theoreticalOutput: ORDER_QTY, outputUnit: "pcs", date: today, note: "Demo packing work order"
    });
    var lcPack = Store.createLineClearance({
      clearanceType: "FR-QA-22", woType: "Pack", woId: pack.id, woRef: pack.woNo,
      campaignNo: pack.campaignNo, date: today, note: "Demo packing line clearance",
      checklist: [
        { item: "Packing line cleared of previous product", ok: true, note: "" },
        { item: "Correct artwork, labels & carton on the line", ok: true, note: "" },
        { item: "Inkjet batch no. & expiry verified", ok: true, note: "" },
        { item: "Fill-weight scale calibrated", ok: true, note: "" }
      ]
    });
    Store.setClearanceStatus(lcPack.id, "Passed");
    Store.transitionPackWo(pack.id, "Released");
    Store.transitionPackWo(pack.id, "InProgress");
    pack = Store.packWoById(pack.id) || pack;
    pack.actualYield = YIELD_PCS; pack.rejects = REJECTS;
    Store.saveWorkOrderPack(pack, false, pack.id);
    Store.transitionPackWo(pack.id, "Done");

    /* ---- 9. Final release (FR-QC-06) -> Approved ---- */
    var rel = Store.createRelease({
      woPackId: pack.id, fgId: DEMO_FG, campaignNo: pack.campaignNo, batchLot: BATCH_LOT,
      qaCopy: "QA release copy - demo", qcCopy: "QC certificate - demo", date: today, note: "Demo final release"
    });
    Store.setReleaseDisposition(rel.id, "Approved");

    /* ---- 10. Mark + self-check + persist ---- */
    db.meta.demoLoaded = true;
    db.meta.demoSoId = so.id;
    db.meta.demoFgId = DEMO_FG;
    db.meta.demoPackWoId = pack.id;

    var packNow = Store.packWoById(pack.id) || pack;
    var ok = packNow.status === "Done" && Store.releaseApproved(packNow.id) && Store.soById(so.id).status === "Confirmed";
    Store.audit("CREATE", "Demo pipeline",
      (ok ? "Loaded" : "Loaded (INCOMPLETE)") + " end-to-end sample for " + fg.kodeFG + " - SO " + so.noSo +
      ", " + ppic.prCount + " PR / " + ppic.calloffCount + " call-off / " + ppic.woCount + " bulk batch, " +
      poLines + " PO line(s), " + (packNow.woNo || pack.id) + " [" + packNow.status + "] rendemen " +
      Engine.fmtNum(packNow.rendemenPct, 2) + "%, release " + rel.releaseNo + " Approved");
    Store.save();

    return {
      alreadyLoaded: false, ok: ok, soNo: so.noSo, packWoNo: packNow.woNo, releaseNo: rel.releaseNo,
      message: (ok ? "Demo pipeline loaded" : "Demo pipeline loaded but INCOMPLETE - check the audit log") +
        " for " + fg.kodeFG + ": SO " + so.noSo + " (" + Engine.fmtNum(ORDER_QTY, 0) + " pcs, Confirmed), " +
        ppic.prCount + " PR + " + ppic.calloffCount + " call-off + " + ppic.woCount + " bulk batch, " +
        poNos.length + " PO (" + poLines + " line(s)) received & QA-released, " + staged + " staging line(s) dispensed, " +
        (bulkWo ? "bulk " + bulkWo.woNo + " Done + BTIP Confirmed, " : "") +
        "pack " + (packNow.woNo || "") + " Done (rendemen " + Engine.fmtNum(packNow.rendemenPct, 2) + "%), release " + rel.releaseNo + " APPROVED. " +
        linked + " materials linked to " + SUPPLIERS.length + " suppliers. " +
        "You can now raise the FG receipt (FR-PR-02) and the Surat Jalan live."
    };
  }

  return { build: build, DEMO_FG: DEMO_FG, CUST_ID: CUST_ID, ORDER_QTY: ORDER_QTY };
})();
