/* ============================================================
   VIEWS - PPIC Netting & Lot Plan
   Turns a Confirmed Sales Order (or a manual what-if) into a
   production plan using the pure netting engine (Netting.plan):
     grossBulkKg = qty x netto x BJ x (1 + bulk loss)
     formula lines scaled on the 100% ratio basis
     packaging lines per unit x qty x (1 + scrap)
     net = gross - (SOH - allocated)
     Astoria shortfall -> PR line rounded UP to MOQ (FR-PP-11)
     Customer shortfall -> call-off (required-by = delivery - lead)
     bulk sized over the mixer catalogue -> campaign work order
   Saving writes t_purchase_req + t_calloff + t_work_order_bulk.
   ============================================================ */
window.ViewsPpic = (function () {

  var lastRun = null;   /* { mode, so, fg, bom, input, plan, saved } */
  var resultWrapEl = null;   /* result container, kept for in-place re-render after save */

  function resolveBj(fgId) {
    var bom = Store.bomByFg(fgId);
    var f = bom && bom.formulaId ? Store.formulaById(bom.formulaId) : null;
    return f && Number(f.bj) > 0 ? Number(f.bj) : 1;
  }

  /* ---------------- main page ---------------- */
  function netting(root) {
    var db = Store.get();
    var canPlan = RBAC.canPlan();
    root.appendChild(UI.pageHead("PPIC Netting & Lot Plan",
      "Explode a Confirmed Sales Order into bulk + packaging requirements, net them against warehouse stock, route shortfalls to a Purchase Request (Astoria) or a call-off (customer-supplied), and size the bulk over the mixer catalogue. Manual what-if mode is retained.",
      []));

    /* ---- mode + source selectors ---- */
    var modeSel = UI.select([["so", "From Sales Order"], ["manual", "Manual (what-if)"]], lastRun ? lastRun.mode : "so");
    var sos = db.salesOrders.slice().sort(function (a, b) {
      return String(b.deliveryDate || "").localeCompare(String(a.deliveryDate || ""));
    });
    var iSo = UI.combo([["", "(select a sales order)"]].concat(sos.map(function (s) {
      var f = Store.fgById(s.fgId);
      return [s.id, (s.noSo || s.id) + "  -  " + (Store.customerById(s.customerId) || {}).name + "  -  " +
        (f ? f.kodeFG : s.fgId) + "  [" + s.status + "]"];
    })), "", "Type to search sales order...");

    var soSummary = UI.el("div", { class: "kv", style: "margin:4px 0 0" });
    var soBlock = UI.el("div", {}, [UI.field("Sales Order", iSo, "Confirmed orders drive production planning."), soSummary]);

    /* ---- manual mode fields ---- */
    var aktifs = db.fgs.filter(function (f) { return f.status === "Aktif" && Store.bomByFg(f.id); }).sort(Store.fgDescCompare);
    var iFg = UI.combo([["", "(select an Aktif Finish Good with a BOM)"]].concat(aktifs.map(function (f) {
      return [f.id, f.kodeFG + "  -  " + (f.deskripsi || "")];
    })), "", "Type to search Finish Good...");
    var iQty = UI.input({ type: "number", step: "1", min: "1", value: "1000" });
    var iNetto = UI.input({ type: "number", step: "0.0001", min: "0", value: "0.1" });
    var iDeliv = UI.input({ type: "date", value: Engine.todayISO() });
    var manualBlock = UI.el("div", { class: "form-grid" }, [
      UI.field("Finish Good", iFg, "Only Aktif SKUs with a production BOM."),
      UI.field("Order Qty (pcs)", iQty),
      UI.field("Netto per unit (kg)", iNetto),
      UI.field("Delivery date", iDeliv)
    ]);

    /* ---- common planning parameters ---- */
    var iBj = UI.input({ type: "number", step: "0.001", min: "0", value: "1" });
    var iLoss = UI.input({ type: "number", step: "0.1", min: "0", value: "3" });
    var paramBlock = UI.el("div", { class: "form-grid" }, [
      UI.field("BJ (specific gravity)", iBj, "Auto-filled from the formula master; editable."),
      UI.field("Bulk process loss (%)", iLoss, "Overfill / transfer loss on the bulk, on top of per-line loss.")
    ]);

    function syncMode() {
      var so = modeSel.value === "so";
      soBlock.hidden = !so;
      manualBlock.hidden = so;
      if (so) { onSoPick(); } else { soSummary.textContent = ""; }
    }
    function onSoPick() {
      var s = Store.soById(iSo.value);
      UI.clear(soSummary);
      if (!s) { iBj.value = "1"; return; }
      var f = Store.fgById(s.fgId);
      iBj.value = String(resolveBj(s.fgId));
      [
        ["Finish Good", f ? (f.kodeFG + " - " + (f.deskripsi || "")) : (s.fgId || "-")],
        ["Customer", (Store.customerById(s.customerId) || {}).name || "-"],
        ["Order qty", Engine.fmtNum(s.orderQty, 0) + " pcs"],
        ["Netto / unit", Engine.fmtNum(s.nettoPerUnit) + " kg"],
        ["Delivery", s.deliveryDate || "-"],
        ["Status", s.status || "Draft"]
      ].forEach(function (p) {
        soSummary.appendChild(UI.el("dt", { text: p[0] }));
        soSummary.appendChild(UI.el("dd", { text: p[1] }));
      });
    }
    modeSel.addEventListener("change", syncMode);
    iSo.addEventListener("change", onSoPick);
    iFg.addEventListener("change", function () { iBj.value = String(resolveBj(iFg.value)); });

    var resultWrap = UI.el("div");
    resultWrapEl = resultWrap;
    var runCard = UI.card("Plan input", [
      UI.btn("Run netting", function () { runNetting(resultWrap, readInput()); }, "btn-primary")
    ], UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [UI.field("Mode", modeSel)]),
      soBlock, manualBlock, paramBlock
    ]));
    root.appendChild(runCard);
    root.appendChild(resultWrap);

    syncMode();
    if (!canPlan) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - only PPIC may save a production plan." }));
    if (lastRun) renderResult(resultWrap);
    else if (!db.mixers.length) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px;color:var(--muted)",
      text: "No mixers in the catalogue yet - the lot plan needs migration 002 (m_mixer) or locally seeded mixers." }));

    /* ---- assemble the netting input from the current mode ---- */
    function readInput() {
      var mode = modeSel.value, so = null, fgId, qty, netto, deliv;
      if (mode === "so") {
        so = Store.soById(iSo.value);
        if (!so) { UI.toast("Select a sales order", "err"); return null; }
        fgId = so.fgId; qty = Number(so.orderQty) || 0; netto = Number(so.nettoPerUnit) || 0; deliv = so.deliveryDate || "";
      } else {
        fgId = iFg.value; qty = Number(iQty.value) || 0; netto = Number(iNetto.value) || 0; deliv = iDeliv.value;
      }
      var fg = Store.fgById(fgId);
      if (!fg) { UI.toast("Select a Finish Good", "err"); return null; }
      if (qty <= 0) { UI.toast("Order quantity must be positive", "err"); return null; }
      if (netto <= 0) { UI.toast("Netto per unit must be greater than zero", "err"); return null; }
      if (!deliv) { UI.toast("Delivery date is required", "err"); return null; }
      var bom = Store.bomByFg(fgId);
      if (!bom) { UI.toast("No production BOM for " + fg.kodeFG + " - netting needs a BOM", "err"); return null; }
      if (fg.status !== "Aktif") UI.toast("Warning: " + fg.kodeFG + " is " + (fg.status || "not Aktif"), "err");
      var bj = Number(iBj.value) > 0 ? Number(iBj.value) : resolveBj(fgId);
      return {
        mode: mode, so: so, fg: fg, bom: bom,
        orderQty: qty, nettoPerUnit: netto, deliveryDate: deliv,
        bj: bj, lossFactor: (Number(iLoss.value) || 0) / 100
      };
    }
  }

  function runNetting(wrap, inp) {
    if (!inp) return;
    var plan = Netting.plan(buildPlanInput(inp));
    lastRun = { mode: inp.mode, so: inp.so, fg: inp.fg, bom: inp.bom, input: inp, plan: plan, saved: null };
    renderResult(wrap);
  }

  /* Map a BOM + material master into the pure engine's input shape. */
  function buildPlanInput(inp) {
    var matMap = Store.matMap();
    function mi(code, unit) {
      var m = matMap[code] || {};
      return {
        name: m.name || ("(unknown " + code + ")"), unit: unit || m.unit || "",
        soh: Number(m.stockQty) || 0, allocated: Store.allocatedOf ? Store.allocatedOf(code) : 0,
        moq: Number(m.moq) || 0, leadDays: Number(m.leadDays) || 0
      };
    }
    var items = inp.bom.items || [];
    var fItems = items.filter(function (it) { return it.section === "FORMULA"; });
    var kItems = items.filter(function (it) { return it.section === "KEMAS"; });
    /* Prefer the stored 100%-basis ratios; fall back to batch-weight ratios
       for legacy BOMs whose pct column predates Phase 1. */
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

  /* ---------------- result ---------------- */
  function netCell(v) {
    return v > 0 ? "<span style='color:var(--red);font-weight:700'>" + Engine.fmtNum(v) + "</span>" : "-";
  }
  function renderResult(wrap) {
    UI.clear(wrap);
    var r = lastRun, p = r.plan;
    var actions = [];
    if (RBAC.canPlan()) {
      actions.push(UI.btn(r.saved ? "Re-save plan" : "Save plan (PR + call-off + campaign)", function () { savePlan(); }, "btn-primary"));
    }
    if (p.prLines.length) actions.push(UI.btn("Print PR (FR-PP-11)", function () { printPR(r); }, ""));
    if (p.calloffLines.length) actions.push(UI.btn("Print call-off", function () { printCallOff(r); }, ""));
    if (p.campaign.batchCount) actions.push(UI.btn("Print lot plan", function () { printCampaign(r); }, ""));

    var head = UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
      UI.el("dt", { text: "Source" }), UI.el("dd", { class: "mono", text: r.mode === "so" ? (r.so.noSo + " [" + r.so.status + "]") : "Manual what-if" }),
      UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: r.fg.kodeFG + " x " + Engine.fmtNum(r.input.orderQty, 0) + " pcs" }),
      UI.el("dt", { text: "BOM" }), UI.el("dd", { class: "mono", text: r.bom.noBom + " rev " + r.bom.revision + " [" + r.bom.status + "]" }),
      UI.el("dt", { text: "Bulk requirement" }), UI.el("dd", { html: "<b>" + Engine.fmtNum(p.grossBulkKg) + " kg</b> &nbsp;(BJ " + Engine.fmtNum(r.input.bj) + ", loss " + Engine.fmtNum(r.input.lossFactor * 100, 1) + "%)" }),
      UI.el("dt", { text: "Shortfall" }), UI.el("dd", { text: p.prLines.length + " PR line(s), " + p.calloffLines.length + " call-off(s)" }),
      UI.el("dt", { text: "Lot plan" }), UI.el("dd", { text: p.campaign.batchCount + " batch(es) over the mixer catalogue" })
    ]);

    var body = UI.el("div", {}, [head]);
    if (r.saved) body.appendChild(UI.el("div", { class: "hint", style: "margin-bottom:10px;color:var(--green);font-weight:600",
      text: "Saved: " + [r.saved.reqNo, r.saved.callOffNo, r.saved.campaignNo].filter(function (x) { return x; }).join("  ·  ") }));

    body.appendChild(sectionTable("Formula explosion (100% ratio basis, scaled to bulk kg)", p.formula, [
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "name" },
      { label: "Ratio %", cls: "num", render: function (l) { return Engine.fmtNum(l.pct, 2); } },
      { label: "Gross kg", cls: "num", render: function (l) { return Engine.fmtNum(l.gross); } },
      { label: "SOH", cls: "num", render: function (l) { return Engine.fmtNum(l.soh); } },
      { label: "Avail", cls: "num", render: function (l) { return Engine.fmtNum(l.available); } },
      { label: "Net kg", cls: "num", render: function (l) { return netCell(l.net); } },
      { label: "Supply", render: function (l) { return UI.tag(l.supportedBy || "-"); } }
    ]));

    body.appendChild(sectionTable("Packaging explosion (per unit x qty x (1 + scrap))", p.packaging, [
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "name" },
      { label: "Qty/unit", cls: "num", render: function (l) { return Engine.fmtNum(l.qtyPerUnit); } },
      { label: "Scrap %", cls: "num", render: function (l) { return Engine.fmtNum(l.scrapPct, 2); } },
      { label: "Gross", cls: "num", render: function (l) { return Engine.fmtNum(l.gross); } },
      { label: "SOH", cls: "num", render: function (l) { return Engine.fmtNum(l.soh); } },
      { label: "Avail", cls: "num", render: function (l) { return Engine.fmtNum(l.available); } },
      { label: "Net", cls: "num", render: function (l) { return netCell(l.net); } },
      { label: "Supply", render: function (l) { return UI.tag(l.supportedBy || "-"); } }
    ]));

    body.appendChild(sectionTable("Purchase Request preview (Astoria shortfall, MOQ-rounded) - FR-PP-11", p.prLines, [
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "name" },
      { label: "Net", cls: "num", render: function (l) { return Engine.fmtNum(l.net); } },
      { label: "MOQ", cls: "num", render: function (l) { return l.moq ? Engine.fmtNum(l.moq) : "-"; } },
      { label: "Order Qty", cls: "num", render: function (l) { return "<b>" + Engine.fmtNum(l.orderQty) + "</b>"; } },
      { label: "Unit", cls: "mono", key: "unit" },
      { label: "Required by", cls: "mono", key: "requiredBy" }
    ], "No Astoria shortfall - stock covers the requirement."));

    body.appendChild(sectionTable("Call-off preview (customer-supplied components)", p.calloffLines, [
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "name" },
      { label: "Qty", cls: "num", render: function (l) { return "<b>" + Engine.fmtNum(l.qty) + "</b>"; } },
      { label: "Unit", cls: "mono", key: "unit" },
      { label: "Required by", cls: "mono", render: function (l) { return Engine.esc(l.requiredBy || "-"); } }
    ], "No customer-supplied shortfall."));

    var batches = (p.campaign.batches || []).map(function (b, i) {
      return { seq: i + 1, mixerName: b.mixerName, mixerId: b.mixerId, vessel: b.vessel, capacityKg: b.capacityKg, plannedKg: b.plannedKg };
    });
    body.appendChild(sectionTable("Lot plan - bulk campaign batches", batches, [
      { label: "Batch #", cls: "num", key: "seq" },
      { label: "Mixer", render: function (b) { return UI.el("span", { class: "mono", text: b.mixerName || b.mixerId }); } },
      { label: "Vessel", key: "vessel" },
      { label: "Capacity kg", cls: "num", render: function (b) { return Engine.fmtNum(b.capacityKg, 0); } },
      { label: "Planned kg", cls: "num", render: function (b) { return "<b>" + Engine.fmtNum(b.plannedKg) + "</b>"; } }
    ], "No mixer catalogue - the lot plan cannot be sized."));

    wrap.appendChild(UI.card("Netting result - " + r.fg.kodeFG, actions, body, { tight: true }));
  }

  function sectionTable(title, rows, cols, emptyText) {
    return UI.el("div", { style: "margin-bottom:14px" }, [
      UI.el("div", { style: "font-weight:700;font-size:12.5px;margin-bottom:4px", text: title }),
      UI.table(cols, rows, { emptyText: emptyText || "No lines." })
    ]);
  }

  /* ---------------- save ---------------- */
  function savePlan() {
    if (!RBAC.canPlan()) { UI.toast("Only PPIC may save a production plan", "err"); return; }
    var r = lastRun;
    if (!r) return;
    var commit = function () {
      var res = Store.savePpicRun({
        soId: r.mode === "so" ? r.so.id : "",
        noSo: r.mode === "so" ? r.so.noSo : "",
        fgId: r.fg.id,
        customerId: r.mode === "so" ? (r.so.customerId || "") : (r.bom.customerId || ""),
        bulkCode: r.bom.bulkCode || "",
        deliveryDate: r.input.deliveryDate,
        date: Engine.todayISO(),
        prLines: r.plan.prLines,
        calloffLines: r.plan.calloffLines,
        batches: r.plan.campaign.batches
      });
      r.saved = res;
      renderResult(resultWrapEl);
      UI.toast("Plan saved: " + res.prCount + " PR, " + res.calloffCount + " call-off, " + res.woCount + " batch(es)", "ok");
    };
    if (r.mode === "so" && r.so.status !== "Confirmed") {
      UI.confirmDialog("Sales order " + r.so.noSo + " is " + r.so.status + ", not Confirmed. Save a production plan anyway?", commit, "Save anyway");
    } else if (r.mode === "so") {
      var existing = Store.get().purchaseReqs.some(function (x) { return x.soId === r.so.id && x.status === "Open"; }) ||
        Store.get().workOrdersBulk.some(function (x) { return x.soId === r.so.id && x.status === "Planned"; });
      if (existing) UI.confirmDialog("This order already has an open plan. Re-running supersedes the previous Open PR / call-off / Planned batches. Continue?", commit, "Re-run plan");
      else commit();
    } else commit();
  }
  /* ---------------- print views ---------------- */
  function linesTable(cols, rows) {
    var h = "<table class='lines'><tr>";
    cols.forEach(function (c) { h += "<th style='width:" + (c.w || "auto") + "'>" + Engine.esc(c.label) + "</th>"; });
    h += "</tr>";
    rows.forEach(function (l, i) {
      h += "<tr>";
      cols.forEach(function (c) { h += "<td class='" + (c.align || "l") + "'>" + c.get(l, i) + "</td>"; });
      h += "</tr>";
    });
    return h + "</table>";
  }

  function printPR(r) {
    var info = [
      ["Source", r.mode === "so" ? r.so.noSo : "Manual what-if"], ["Finish Good", r.fg.kodeFG],
      ["Delivery", r.input.deliveryDate || "-"], ["Bulk kg", Engine.fmtNum(r.plan.grossBulkKg)],
      ["PR lines", String(r.plan.prLines.length)], ["BOM", r.bom.noBom + " rev " + r.bom.revision]
    ];
    var tbl = linesTable([
      { label: "No", w: "5%", align: "c", get: function (l, i) { return String(i + 1); } },
      { label: "Item Code", w: "14%", align: "c", get: function (l) { return Engine.esc(l.materialCode); } },
      { label: "Description", get: function (l) { return Engine.esc(l.name); } },
      { label: "Net", w: "10%", align: "r", get: function (l) { return Engine.fmtNum(l.net); } },
      { label: "MOQ", w: "8%", align: "r", get: function (l) { return l.moq ? Engine.fmtNum(l.moq) : "-"; } },
      { label: "Order Qty", w: "12%", align: "r", get: function (l) { return "<b>" + Engine.fmtNum(l.orderQty) + "</b>"; } },
      { label: "Unit", w: "7%", align: "c", get: function (l) { return Engine.esc(l.unit); } },
      { label: "Required by", w: "12%", align: "c", get: function (l) { return Engine.esc(l.requiredBy || "-"); } }
    ], r.plan.prLines);
    UI.printHTML(UI.docShell("PURCHASE REQUEST (FR-PP-11)", info, tbl,
      ["Diminta oleh (PPIC)", "Diperiksa oleh (Purchasing)", "Disetujui oleh (Manager)"],
      "Astoria-supplied shortfalls from PPIC netting; order quantity is the net requirement rounded UP to the supplier MOQ."));
  }

  function printCallOff(r) {
    var cust = r.mode === "so" ? (Store.customerById(r.so.customerId) || {}) : (Store.customerById(r.bom.customerId) || {});
    var info = [
      ["Source", r.mode === "so" ? r.so.noSo : "Manual what-if"], ["Customer", cust.name || "-"],
      ["Finish Good", r.fg.kodeFG], ["Delivery", r.input.deliveryDate || "-"],
      ["Call-off lines", String(r.plan.calloffLines.length)], ["BOM", r.bom.noBom + " rev " + r.bom.revision]
    ];
    var tbl = linesTable([
      { label: "No", w: "6%", align: "c", get: function (l, i) { return String(i + 1); } },
      { label: "Item Code", w: "18%", align: "c", get: function (l) { return Engine.esc(l.materialCode); } },
      { label: "Description", get: function (l) { return Engine.esc(l.name); } },
      { label: "Qty", w: "14%", align: "r", get: function (l) { return "<b>" + Engine.fmtNum(l.qty) + "</b>"; } },
      { label: "Unit", w: "10%", align: "c", get: function (l) { return Engine.esc(l.unit); } },
      { label: "Required by", w: "16%", align: "c", get: function (l) { return Engine.esc(l.requiredBy || "-"); } }
    ], r.plan.calloffLines);
    UI.printHTML(UI.docShell("CUSTOMER CALL-OFF INSTRUCTION", info, tbl,
      ["Dibuat oleh (PPIC)", "Diketahui oleh (Marketing)", "Disetujui oleh (Manager)"],
      "Customer-supplied components are never Astoria stock; required-by = delivery date minus the component lead time."));
  }

  function printCampaign(r) {
    var info = [
      ["Source", r.mode === "so" ? r.so.noSo : "Manual what-if"], ["Finish Good", r.fg.kodeFG],
      ["Bulk code", r.bom.bulkCode || "-"], ["Bulk kg", Engine.fmtNum(r.plan.grossBulkKg)],
      ["Batches", String(r.plan.campaign.batchCount)], ["Delivery", r.input.deliveryDate || "-"]
    ];
    var tbl = linesTable([
      { label: "Batch #", w: "12%", align: "c", get: function (l, i) { return String(i + 1); } },
      { label: "Mixer", get: function (l) { return Engine.esc(l.mixerName || l.mixerId); } },
      { label: "Vessel", w: "24%", get: function (l) { return Engine.esc(l.vessel || "-"); } },
      { label: "Capacity kg", w: "16%", align: "r", get: function (l) { return Engine.fmtNum(l.capacityKg, 0); } },
      { label: "Planned kg", w: "16%", align: "r", get: function (l) { return "<b>" + Engine.fmtNum(l.plannedKg) + "</b>"; } }
    ], r.plan.campaign.batches);
    UI.printHTML(UI.docShell("BULK CAMPAIGN WORK ORDER (lot plan)", info, tbl,
      ["Direncanakan oleh (PPIC)", "Diperiksa oleh (Production)", "Disetujui oleh (Manager)"],
      "Mixer-sized batches minimising the batch count; the largest vessel runs full batches and the remainder is right-sized."));
  }

  /* buildPlanInput is exposed so the node integration harness exercises the
     exact production BOM -> netting mapping (not a copy of it). */
  return { netting: netting, buildPlanInput: buildPlanInput };
})();
