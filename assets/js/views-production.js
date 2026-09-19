/* ============================================================
   VIEWS - Production execution (Phase 4)
   Runs the campaign work orders PPIC emitted:
     1. Bulk mixing - BMR phase rows (FR-QA-12) / daily sheet
        (FR-PR-23) with theoretical vs actual weight per phase; the
        WO walks Planned -> Released -> InProgress -> Done and the
        InProgress step is gated by the FR-QA-21 line clearance.
     2. BTIP bulk transfer (FR-PR-21/22) vessel -> hopper.
     3. Packing - pack work order (FR-QA-13) with theoretical output,
        rejects, actual yield, labor/machine hours and rendemen %
        hard-checked to 95-100% (a variance remark is mandatory to
        close outside the band); InProgress is gated by FR-QA-22.
   ============================================================ */
window.ViewsProduction = (function () {

  var bulkFilter = { q: "", status: "" };
  var btipFilter = { q: "", status: "" };
  var packFilter = { q: "", status: "" };

  function woPill(s) {
    var cls = s === "Done" ? "aktif" : s === "Void" ? "nonaktif" : s === "Planned" ? "pending" : "info";
    return UI.el("span", { class: "pill " + cls, text: s || "Planned" });
  }
  function btipPill(s) {
    var cls = s === "Confirmed" ? "aktif" : s === "Void" ? "nonaktif" : "pending";
    return UI.el("span", { class: "pill " + cls, text: s || "Draft" });
  }
  function mixerName(id) { var m = id ? Store.mixerById(id) : null; return m ? m.name : (id || "-"); }
  function fgKode(fgId) { var f = Store.fgById(fgId); return f ? f.kodeFG : (fgId || "-"); }
  function matOptions() {
    var db = Store.get();
    return [["", "(material)"]].concat(db.materials.slice()
      .sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); })
      .map(function (m) { return [m.code, m.code + " - " + (m.name || "")]; }));
  }
  function rendemenCell(pct) {
    var bad = pct > 0 && (pct < 95 || pct > 100);
    return "<b style='color:" + (bad ? "var(--red)" : "var(--green)") + "'>" + Engine.fmtNum(pct, 2) + " %</b>";
  }

  /* ---------------- page ---------------- */
  function list(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("Production",
      "Execute the campaign: record BMR mixing phases (FR-QA-12 / FR-PR-23) against the released bulk work orders, log BTIP vessel-to-hopper transfers (FR-PR-21/22), then run filling & packing (FR-QA-13) with a rendemen check. QA line clearances gate each step.",
      []));
    root.appendChild(bulkCard(db));
    root.appendChild(btipCard(db));
    root.appendChild(packCard(db));
    if (!RBAC.canProduce()) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - production execution is run by Production." }));
  }

  /* ---------- 1. bulk work orders + BMR phases ---------- */
  function bulkCard(db) {
    var canProd = RBAC.canProduce();
    var search = UI.input({ placeholder: "Search campaign / WO / FG...", value: bulkFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Planned", "Planned"], ["Released", "Released"], ["InProgress", "InProgress"], ["Done", "Done"], ["Void", "Void"]], bulkFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = bulkFilter.q.toLowerCase();
      var rows = db.workOrdersBulk.filter(function (w) {
        if (bulkFilter.status && w.status !== bulkFilter.status) return false;
        if (!q) return true;
        return ((w.campaignNo || "") + " " + (w.woNo || "") + " " + fgKode(w.fgId) + " " + (w.bulkCode || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Campaign / WO", cls: "mono", render: function (w) { return "<b>" + Engine.esc(w.campaignNo || w.woNo) + "</b>"; } },
        { label: "Batch", cls: "num", render: function (w) { return String(w.batchSeq); } },
        { label: "Finish Good", cls: "mono", render: function (w) { return Engine.esc(fgKode(w.fgId)); } },
        { label: "Bulk code", cls: "mono", render: function (w) { return Engine.esc(w.bulkCode || "-"); } },
        { label: "Planned kg", cls: "num", render: function (w) { return Engine.fmtNum(w.plannedKg, 2); } },
        { label: "Mixer", render: function (w) { return Engine.esc(mixerName(w.mixerId)); } },
        { label: "FR-QA-21", render: function (w) { return Store.clearancePassed(w.id, "FR-QA-21") ? UI.el("span", { class: "pill aktif", text: "Passed" }) : UI.el("span", { class: "pill pending", text: "Open" }); } },
        { label: "Status", render: function (w) { return woPill(w.status); } },
        { label: "", render: function (w) { return bulkActions(w, canProd); } }
      ], rows, { emptyText: "No bulk work order yet. Run PPIC netting to emit the campaign batches." }));
    }
    function bulkActions(w, canProd) {
      var btns = [UI.btn("BMR", function () { bmrEditor(w); }, "btn-sm")];
      if (canProd || RBAC.canPlan()) RBAC.transitionsFrom("workOrderBulk", w.status).forEach(function (t) {
        btns.push(UI.btn(t.to, function () { bulkTransition(w, t.to); }, "btn-sm " + (t.to === "Void" ? "btn-danger" : "btn-primary")));
      });
      btns.push(UI.btn("Print", function () { printBmr(w.id); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function bulkTransition(w, to) {
      if (to === "InProgress" && !Store.clearancePassed(w.id, "FR-QA-21")) {
        UI.toast("FR-QA-21 mixing line clearance must be Passed first (QA / QC page)", "err"); return;
      }
      if (Store.transitionBulkWo(w.id, to)) { App.refresh(); UI.toast("Bulk WO " + to, "ok"); }
      else UI.toast("Transition not allowed for your role", "err");
    }
    search.addEventListener("input", function () { bulkFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { bulkFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Bulk work orders (BMR mixing FR-QA-12 / FR-PR-23)" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.workOrdersBulk.length + " batches" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }

  function bmrEditor(wo) {
    var canProd = RBAC.canProduce();
    var phasesWrap = UI.el("div");
    var iNo = UI.input({ type: "number", step: "1", min: "1", value: "", style: "width:64px", placeholder: "#" });
    var iName = UI.input({ value: "", placeholder: "Phase name", style: "width:170px" });
    var iMat = UI.combo(matOptions(), "", "Material...");
    var iTheo = UI.input({ type: "number", step: "0.0001", value: "", style: "width:110px", placeholder: "theor. kg" });
    var iAct = UI.input({ type: "number", step: "0.0001", value: "", style: "width:110px", placeholder: "actual kg" });
    var iVessel = UI.input({ value: "", placeholder: "vessel", style: "width:110px" });
    var iHz = UI.input({ type: "number", step: "0.1", value: "", style: "width:74px", placeholder: "Hz" });
    var iTemp = UI.input({ type: "number", step: "0.1", value: "", style: "width:74px", placeholder: "\u00b0C" });
    var iOp = UI.input({ value: "", placeholder: "operator", style: "width:120px" });

    function draw() {
      UI.clear(phasesWrap);
      var rows = Store.phasesFor(wo.id);
      var totT = rows.reduce(function (a, p) { return a + (Number(p.theoreticalKg) || 0); }, 0);
      var totA = rows.reduce(function (a, p) { return a + (Number(p.actualKg) || 0); }, 0);
      phasesWrap.appendChild(UI.table([
        { label: "#", cls: "num", render: function (p) { return String(p.phaseNo); } },
        { label: "Phase", render: function (p) { return Engine.esc(p.phaseName || "-"); } },
        { label: "Material", cls: "mono", render: function (p) { return Engine.esc(p.materialCode || "-"); } },
        { label: "Theoretical kg", cls: "num", render: function (p) { return Engine.fmtNum(p.theoreticalKg); } },
        { label: "Actual kg", cls: "num", render: function (p) {
          if (!canProd) return Engine.fmtNum(p.actualKg);
          var inp = UI.input({ type: "number", step: "0.0001", value: String(p.actualKg || ""), style: "width:110px" });
          inp.addEventListener("change", function () {
            p.actualKg = Number(inp.value) || 0; Store.saveBulkPhase(p, false, p.id);
          });
          return inp;
        } },
        { label: "Vessel", render: function (p) { return Engine.esc(p.vessel || "-"); } },
        { label: "Hz / \u00b0C", cls: "num", render: function (p) { return Engine.fmtNum(p.homogenizerHz, 1) + " / " + Engine.fmtNum(p.temperatureC, 1); } },
        { label: "Operator", render: function (p) { return Engine.esc(p.operator || "-"); } },
        { label: "", render: function (p) { return canProd ? UI.btn("Del", function () {
          UI.confirmDialog("Delete BMR phase " + p.phaseNo + " (" + (p.materialCode || p.phaseName) + ")?", function () { Store.deleteBulkPhase(p.id); draw(); });
        }, "btn-sm btn-danger") : null; } }
      ], rows, { emptyText: "No BMR phase recorded yet. Add a phase or seed from the BOM." }));
      phasesWrap.appendChild(UI.el("div", { class: "hint", style: "margin-top:4px;text-align:right",
        text: "Total theoretical " + Engine.fmtNum(totT, 2) + " kg / actual " + Engine.fmtNum(totA, 2) + " kg (planned " + Engine.fmtNum(wo.plannedKg, 2) + " kg)" }));
    }
    function addPhase() {
      if (!canProd) { UI.toast("Only Production may record BMR phases", "err"); return; }
      var rec = {
        id: Store.uid("PH"), woId: wo.id, phaseNo: Number(iNo.value) || (Store.phasesFor(wo.id).length + 1),
        phaseName: iName.value.trim(), materialCode: iMat.value || "", materialName: (Store.matMap()[iMat.value] || {}).name || "",
        theoreticalKg: Number(iTheo.value) || 0, actualKg: Number(iAct.value) || 0, vessel: iVessel.value.trim(),
        homogenizerHz: Number(iHz.value) || 0, temperatureC: Number(iTemp.value) || 0,
        startedAt: "", endedAt: "", operator: iOp.value.trim(), note: ""
      };
      Store.saveBulkPhase(rec, true, null);
      [iNo, iName, iTheo, iAct, iVessel, iHz, iTemp, iOp].forEach(function (n) { n.value = ""; });
      iMat.value = ""; draw();
    }
    function seedFromBom() {
      if (!canProd) { UI.toast("Only Production may record BMR phases", "err"); return; }
      var bom = Store.bomByFg(wo.fgId);
      if (!bom) { UI.toast("No production BOM for this FG", "err"); return; }
      var formula = (bom.items || []).filter(function (it) { return it.section === "FORMULA"; });
      if (!formula.length) { UI.toast("BOM has no FORMULA lines", "err"); return; }
      var existing = Store.phasesFor(wo.id).length;
      formula.forEach(function (it, i) {
        Store.saveBulkPhase({
          id: Store.uid("PH"), woId: wo.id, phaseNo: existing + i + 1, phaseName: "Phase " + (existing + i + 1),
          materialCode: it.materialCode || "", materialName: (Store.matMap()[it.materialCode] || {}).name || "",
          theoreticalKg: Engine.round4((Number(it.pct) || 0) / 100 * (Number(wo.plannedKg) || 0)), actualKg: 0,
          vessel: "", homogenizerHz: 0, temperatureC: 0, startedAt: "", endedAt: "", operator: "", note: "Seeded from BOM (" + Engine.fmtNum(it.pct, 2) + "%)"
        }, true, null);
      });
      draw(); UI.toast("Seeded " + formula.length + " theoretical phase(s) from the BOM", "ok");
    }

    UI.modal({
      title: "BMR mixing - " + (wo.campaignNo || wo.woNo) + " batch " + wo.batchSeq + " (" + fgKode(wo.fgId) + ")",
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:8px" }, [
          UI.el("dt", { text: "Status" }), UI.el("dd", {}, [woPill(wo.status)]),
          UI.el("dt", { text: "Mixer" }), UI.el("dd", { text: mixerName(wo.mixerId) }),
          UI.el("dt", { text: "Planned" }), UI.el("dd", { text: Engine.fmtNum(wo.plannedKg, 2) + " kg" }),
          UI.el("dt", { text: "FR-QA-21" }), UI.el("dd", { text: Store.clearancePassed(wo.id, "FR-QA-21") ? "Passed" : "Open (gates InProgress)" })
        ]),
        canProd ? UI.el("div", { class: "toolbar", style: "margin:6px 0;flex-wrap:wrap" }, [iNo, iName, iMat, iTheo, iAct, iVessel, iHz, iTemp, iOp, UI.btn("Add phase", addPhase, "btn-primary")]) : null,
        phasesWrap
      ]),
      actions: canProd ? [{ label: "Seed phases from BOM", onClick: seedFromBom }, { label: "Print BMR", onClick: function () { UI.closeModal(); printBmr(wo.id); } }]
        : [{ label: "Print BMR", onClick: function () { UI.closeModal(); printBmr(wo.id); } }]
    });
    draw();
  }

  /* ---------- 2. BTIP bulk transfer (FR-PR-21/22) ---------- */
  function btipCard(db) {
    var canProd = RBAC.canProduce();
    var search = UI.input({ placeholder: "Search transfer no / vessel / hopper...", value: btipFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Draft", "Draft"], ["Confirmed", "Confirmed"], ["Void", "Void"]], btipFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = btipFilter.q.toLowerCase();
      var rows = db.btipTransfers.filter(function (b) {
        if (btipFilter.status && b.status !== btipFilter.status) return false;
        if (!q) return true;
        return ((b.transferNo || "") + " " + (b.fromVessel || "") + " " + (b.toHopper || "") + " " + (b.bulkCode || "") + " " + (b.campaignNo || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Transfer No", cls: "mono", render: function (b) { return "<b>" + Engine.esc(b.transferNo) + "</b>"; } },
        { label: "Campaign", cls: "mono", render: function (b) { return Engine.esc(b.campaignNo || "-"); } },
        { label: "From vessel", render: function (b) { return Engine.esc(b.fromVessel || "-"); } },
        { label: "To hopper", render: function (b) { return Engine.esc(b.toHopper || "-"); } },
        { label: "Bulk code", cls: "mono", render: function (b) { return Engine.esc(b.bulkCode || "-"); } },
        { label: "Qty", cls: "num", render: function (b) { return Engine.fmtNum(b.qty) + " " + Engine.esc(b.uom || ""); } },
        { label: "By / QA", render: function (b) { return UI.el("span", { style: "font-size:11.5px", text: [b.transferredBy, b.qaBy].filter(Boolean).join(" / ") || "-" }); } },
        { label: "Status", render: function (b) { return btipPill(b.status); } },
        { label: "", render: function (b) { return btipActions(b, canProd); } }
      ], rows, { emptyText: "No BTIP transfer yet." }));
    }
    function btipActions(b, canProd) {
      var btns = [];
      if (canProd && b.status === "Draft") btns.push(UI.btn("Confirm", function () {
        UI.confirmDialog("Confirm BTIP transfer " + b.transferNo + " (" + Engine.fmtNum(b.qty) + " " + (b.uom || "") + " " + b.fromVessel + " \u2192 " + b.toHopper + ")?", function () {
          b.status = "Confirmed"; Store.saveBtipTransfer(b, false, b.id); App.refresh(); UI.toast("Transfer confirmed", "ok");
        });
      }, "btn-sm btn-primary"));
      btns.push(UI.btn("Print", function () { printBtip(b.transferNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    search.addEventListener("input", function () { btipFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { btipFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "BTIP bulk transfer (FR-PR-21 / FR-PR-22)" }),
      canProd ? UI.btn("New transfer", btipEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.btipTransfers.length + " transfers" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function btipEditor() {
    if (!RBAC.canProduce()) { UI.toast("Only Production may record a BTIP transfer", "err"); return; }
    var db = Store.get();
    var wos = db.workOrdersBulk.filter(function (w) { return w.status === "InProgress" || w.status === "Released" || w.status === "Done"; });
    var iWo = UI.combo([["", "(no work order)"]].concat(wos.map(function (w) {
      return [w.id, (w.campaignNo || w.woNo) + " \u00b7 batch " + w.batchSeq + " \u00b7 " + fgKode(w.fgId) + " \u00b7 " + Engine.fmtNum(w.plannedKg, 0) + " kg"];
    })), "", "Type to search work order...");
    var iFrom = UI.input({ value: "", placeholder: "Source vessel (e.g. Himix)" });
    var iTo = UI.input({ value: "", placeholder: "Destination hopper / tank" });
    var iBulk = UI.input({ value: "", placeholder: "Bulk code" });
    var iQty = UI.input({ type: "number", step: "0.0001", min: "0", value: "", style: "width:140px" });
    var iUom = UI.input({ value: "Kg", style: "width:80px" });
    var iQa = UI.input({ value: "", placeholder: "QA verified by" });
    var iNote = UI.input({ value: "", placeholder: "Note" });
    UI.modal({
      title: "New BTIP transfer", wide: true,
      body: UI.el("div", {}, [
        UI.field("Work order", iWo),
        UI.el("div", { class: "form-grid" }, [
          UI.field("From vessel", iFrom), UI.field("To hopper", iTo), UI.field("Bulk code", iBulk),
          UI.field("Qty", iQty), UI.field("UoM", iUom), UI.field("QA verified by", iQa)
        ]),
        UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Create transfer (Draft)", cls: "btn-primary", onClick: function () {
          var qty = Number(iQty.value) || 0;
          if (qty <= 0) { UI.toast("Quantity must be positive", "err"); return; }
          var w = iWo.value ? db.workOrdersBulk.filter(function (x) { return x.id === iWo.value; })[0] : null;
          var res = Store.createBtipTransfer({
            woId: iWo.value || "", campaignNo: w ? w.campaignNo : "", fromVessel: iFrom.value.trim(), toHopper: iTo.value.trim(),
            bulkCode: iBulk.value.trim() || (w ? w.bulkCode : ""), qty: qty, uom: iUom.value.trim() || "Kg",
            qaBy: iQa.value.trim(), note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh(); UI.toast("BTIP " + res.transferNo + " created (Draft)", "ok");
        }
      }]
    });
  }

  /* ---------- 3. pack work orders (FR-QA-13) ---------- */
  function packCard(db) {
    var canProd = RBAC.canProduce();
    var search = UI.input({ placeholder: "Search pack WO / campaign / FG...", value: packFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Planned", "Planned"], ["Released", "Released"], ["InProgress", "InProgress"], ["Done", "Done"], ["Void", "Void"]], packFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = packFilter.q.toLowerCase();
      var rows = db.workOrdersPack.filter(function (w) {
        if (packFilter.status && w.status !== packFilter.status) return false;
        if (!q) return true;
        return ((w.woNo || "") + " " + (w.campaignNo || "") + " " + fgKode(w.fgId) + " " + (w.bulkCode || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Pack WO", cls: "mono", render: function (w) { return "<b>" + Engine.esc(w.woNo) + "</b>"; } },
        { label: "Campaign", cls: "mono", render: function (w) { return Engine.esc(w.campaignNo || "-"); } },
        { label: "Finish Good", cls: "mono", render: function (w) { return Engine.esc(fgKode(w.fgId)); } },
        { label: "Theoretical", cls: "num", render: function (w) { return Engine.fmtNum(w.theoreticalOutput, 0) + " " + Engine.esc(w.outputUnit || ""); } },
        { label: "Rejects", cls: "num", render: function (w) { return Engine.fmtNum(w.rejects, 0); } },
        { label: "Actual yield", cls: "num", render: function (w) { return Engine.fmtNum(w.actualYield, 0); } },
        { label: "Rendemen", cls: "num", render: function (w) { return rendemenCell(Number(w.rendemenPct) || 0); } },
        { label: "FR-QA-22", render: function (w) { return Store.clearancePassed(w.id, "FR-QA-22") ? UI.el("span", { class: "pill aktif", text: "Passed" }) : UI.el("span", { class: "pill pending", text: "Open" }); } },
        { label: "Status", render: function (w) { return woPill(w.status); } },
        { label: "", render: function (w) { return packActions(w, canProd); } }
      ], rows, { emptyText: "No pack work order yet. Create one from a Done bulk batch." }));
    }
    function packActions(w, canProd) {
      var btns = [];
      if (canProd && (w.status === "Released" || w.status === "InProgress")) btns.push(UI.btn("Record yield", function () { yieldEditor(w); }, "btn-sm btn-primary"));
      if (canProd || RBAC.canPlan()) RBAC.transitionsFrom("workOrderPack", w.status).forEach(function (t) {
        btns.push(UI.btn(t.to, function () { packTransition(w, t.to); }, "btn-sm " + (t.to === "Void" ? "btn-danger" : "")));
      });
      btns.push(UI.btn("Print", function () { printPackWo(w.woNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function packTransition(w, to) {
      if (to === "InProgress" && !Store.clearancePassed(w.id, "FR-QA-22")) {
        UI.toast("FR-QA-22 packing line clearance must be Passed first (QA / QC page)", "err"); return;
      }
      if (Store.transitionPackWo(w.id, to)) { App.refresh(); UI.toast("Pack WO " + to, "ok"); }
      else UI.toast("Blocked - check rendemen 95-100% / variance remark / role", "err");
    }
    search.addEventListener("input", function () { packFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { packFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Packing work orders (BMR filling & packing FR-QA-13)" }),
      (canProd || RBAC.canPlan()) ? UI.btn("New pack WO", packEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.workOrdersPack.length + " work orders" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function packEditor() {
    if (!RBAC.canProduce() && !RBAC.canPlan()) { UI.toast("Only Production / PPIC may raise a pack work order", "err"); return; }
    var db = Store.get();
    var done = db.workOrdersBulk.filter(function (w) { return w.status === "Done"; });
    var iBulk = UI.combo([["", "(select a finished bulk batch)"]].concat(done.map(function (w) {
      return [w.id, (w.campaignNo || w.woNo) + " \u00b7 batch " + w.batchSeq + " \u00b7 " + fgKode(w.fgId) + " \u00b7 " + Engine.fmtNum(w.plannedKg, 2) + " kg"];
    })), "", "Type to search bulk batch...");
    var iTheo = UI.input({ type: "number", step: "1", min: "0", value: "", style: "width:160px", placeholder: "theoretical output" });
    var iUnit = UI.select([["pcs", "pcs"], ["Kg", "Kg"], ["unit", "unit"], ["box", "box"]], "pcs");
    var iNote = UI.input({ value: "", placeholder: "Note" });
    UI.modal({
      title: "New pack work order (FR-QA-13)", wide: true,
      body: UI.el("div", {}, [
        UI.field("Finished bulk batch", iBulk, done.length ? "Packing draws on a bulk batch that reached Done." : "No bulk batch is Done yet - finish mixing first."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Theoretical output", iTheo, "Expected saleable output; rendemen = actual / theoretical."),
          UI.field("Output unit", iUnit)
        ]),
        UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Create pack WO", cls: "btn-primary", onClick: function () {
          if (!iBulk.value) { UI.toast("Select a finished bulk batch", "err"); return; }
          var b = db.workOrdersBulk.filter(function (x) { return x.id === iBulk.value; })[0];
          var res = Store.createPackWo({
            campaignNo: b.campaignNo, soId: b.soId, fgId: b.fgId, bulkWoId: b.id, bulkCode: b.bulkCode,
            theoreticalOutput: Number(iTheo.value) || 0, outputUnit: iUnit.value, note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh(); UI.toast("Pack WO " + res.woNo + " created (Planned)", "ok");
        }
      }]
    });
  }
  function yieldEditor(w) {
    if (!RBAC.canProduce()) { UI.toast("Only Production may record the yield", "err"); return; }
    var iRej = UI.input({ type: "number", step: "1", min: "0", value: String(w.rejects || 0) });
    var iYield = UI.input({ type: "number", step: "1", min: "0", value: String(w.actualYield || 0) });
    var iLabor = UI.input({ type: "number", step: "0.1", min: "0", value: String(w.laborHours || 0) });
    var iMachine = UI.input({ type: "number", step: "0.1", min: "0", value: String(w.machineHours || 0) });
    var iRemark = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "Variance remark (mandatory if rendemen is outside 95-100%)" });
    iRemark.value = w.varianceRemark || "";
    var preview = UI.el("div", { class: "hint", style: "margin-top:6px" });
    function upd() {
      var r = Store.rendemenOf(w.theoreticalOutput, Number(iYield.value) || 0);
      var bad = r < 95 || r > 100;
      preview.innerHTML = "Rendemen = " + Engine.fmtNum(r, 2) + " % " +
        (bad ? "<span style='color:var(--red)'>(outside 95-100% - a variance remark is required to close)</span>" : "<span style='color:var(--green)'>(within 95-100%)</span>");
    }
    iYield.addEventListener("input", upd); upd();
    UI.modal({
      title: "Record yield - " + w.woNo, wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "hint", style: "margin-bottom:8px;color:var(--muted)",
          text: fgKode(w.fgId) + " - theoretical output " + Engine.fmtNum(w.theoreticalOutput, 0) + " " + (w.outputUnit || "") + "." }),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Rejects", iRej), UI.field("Actual yield", iYield),
          UI.field("Labor hours", iLabor), UI.field("Machine hours", iMachine)
        ]),
        UI.field("Variance remark", iRemark), preview
      ]),
      actions: [{
        label: "Save yield", cls: "btn-primary", onClick: function () {
          w.rejects = Number(iRej.value) || 0; w.actualYield = Number(iYield.value) || 0;
          w.laborHours = Number(iLabor.value) || 0; w.machineHours = Number(iMachine.value) || 0;
          w.varianceRemark = iRemark.value.trim();
          Store.saveWorkOrderPack(w, false, w.id);
          UI.closeModal(); App.refresh();
          UI.toast("Yield saved - rendemen " + Engine.fmtNum(Store.packWoById(w.id).rendemenPct, 2) + " %", "ok");
        }
      }]
    });
  }

  /* ---------------- print views ---------------- */
  function printBmr(woId) {
    var wo = Store.get().workOrdersBulk.filter(function (w) { return String(w.id) === String(woId); })[0];
    if (!wo) { UI.toast("No bulk work order", "err"); return; }
    var phases = Store.phasesFor(wo.id);
    var totT = phases.reduce(function (a, p) { return a + (Number(p.theoreticalKg) || 0); }, 0);
    var totA = phases.reduce(function (a, p) { return a + (Number(p.actualKg) || 0); }, 0);
    var rows = phases.map(function (p) {
      return "<tr><td class='c'>" + p.phaseNo + "</td><td>" + Engine.esc(p.phaseName || "") + "</td>" +
        "<td class='c'>" + Engine.esc(p.materialCode || "") + "</td><td>" + Engine.esc(p.materialName || "") + "</td>" +
        "<td class='r'>" + Engine.fmtNum(p.theoreticalKg) + "</td><td class='r'>" + Engine.fmtNum(p.actualKg) + "</td>" +
        "<td class='c'>" + Engine.esc(p.vessel || "") + "</td><td class='r'>" + Engine.fmtNum(p.homogenizerHz, 1) + "</td>" +
        "<td class='r'>" + Engine.fmtNum(p.temperatureC, 1) + "</td><td class='c'>" + Engine.esc(p.operator || "") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:4%'>No</th><th style='width:14%'>Phase</th><th style='width:10%'>Material</th>" +
      "<th>Description</th><th style='width:9%'>Theor. kg</th><th style='width:9%'>Actual kg</th><th style='width:9%'>Vessel</th>" +
      "<th style='width:6%'>Hz</th><th style='width:6%'>\u00b0C</th><th style='width:10%'>Operator</th></tr>" + rows +
      "<tr><td colspan='4' class='r'><b>Total</b></td><td class='r'><b>" + Engine.fmtNum(totT, 2) + "</b></td><td class='r'><b>" + Engine.fmtNum(totA, 2) + "</b></td><td colspan='4'></td></tr></table>";
    UI.printHTML(UI.docShell("BATCH MANUFACTURING RECORD - MIXING (FR-QA-12 / FR-PR-23)", [
      ["Campaign / WO", wo.campaignNo || wo.woNo], ["Batch seq", String(wo.batchSeq)],
      ["Finish Good", fgKode(wo.fgId)], ["Bulk code", wo.bulkCode || "-"],
      ["Mixer", mixerName(wo.mixerId)], ["Planned kg", Engine.fmtNum(wo.plannedKg, 2)], ["Status", wo.status]
    ], h, ["Diolah oleh (Produksi)", "Diperiksa oleh (QA)", "Disetujui oleh (Produksi Supervisor)"], ""));
  }
  function printBtip(no) {
    var b = Store.get().btipTransfers.filter(function (x) { return x.transferNo === no; })[0];
    if (!b) { UI.toast("No BTIP transfer " + no, "err"); return; }
    var h = "<table class='lines'><tr><th>From vessel</th><th>To hopper</th><th style='width:14%'>Bulk code</th>" +
      "<th style='width:12%'>Qty</th><th style='width:8%'>UoM</th><th style='width:14%'>Status</th></tr>" +
      "<tr><td>" + Engine.esc(b.fromVessel || "-") + "</td><td>" + Engine.esc(b.toHopper || "-") + "</td>" +
      "<td class='c'>" + Engine.esc(b.bulkCode || "-") + "</td><td class='r'>" + Engine.fmtNum(b.qty) + "</td>" +
      "<td class='c'>" + Engine.esc(b.uom || "") + "</td><td class='c'><b>" + Engine.esc(b.status) + "</b></td></tr></table>";
    UI.printHTML(UI.docShell("BULK TRANSFER IN-PROCESS (FR-PR-21 / FR-PR-22)", [
      ["Transfer No", b.transferNo], ["Campaign", b.campaignNo || "-"],
      ["Transferred by", b.transferredBy || "-"], ["QA verified by", b.qaBy || "-"], ["Transferred at", b.transferredAt || "-"]
    ], h, ["Diserahkan oleh (Produksi)", "Diperiksa oleh (QA)", "Diterima oleh (Filling)"], b.note ? "Note: " + Engine.esc(b.note) : ""));
  }
  function printPackWo(no) {
    var w = Store.get().workOrdersPack.filter(function (x) { return x.woNo === no; })[0];
    if (!w) { UI.toast("No pack WO " + no, "err"); return; }
    var r = Number(w.rendemenPct) || 0, bad = r < 95 || r > 100;
    var h = "<table class='lines'><tr><th>Theoretical output</th><th style='width:12%'>Rejects</th>" +
      "<th style='width:14%'>Actual yield</th><th style='width:12%'>Labor hrs</th><th style='width:12%'>Machine hrs</th>" +
      "<th style='width:14%'>Rendemen</th></tr>" +
      "<tr><td class='r'>" + Engine.fmtNum(w.theoreticalOutput, 0) + " " + Engine.esc(w.outputUnit || "") + "</td>" +
      "<td class='r'>" + Engine.fmtNum(w.rejects, 0) + "</td><td class='r'>" + Engine.fmtNum(w.actualYield, 0) + "</td>" +
      "<td class='r'>" + Engine.fmtNum(w.laborHours, 1) + "</td><td class='r'>" + Engine.fmtNum(w.machineHours, 1) + "</td>" +
      "<td class='r'><b style='color:" + (bad ? "#c00" : "#080") + "'>" + Engine.fmtNum(r, 2) + " %</b></td></tr></table>" +
      (w.varianceRemark ? "<div class='doc-note'>Variance remark: " + Engine.esc(w.varianceRemark) + "</div>" : "");
    UI.printHTML(UI.docShell("BATCH MANUFACTURING RECORD - FILLING & PACKING (FR-QA-13)", [
      ["Pack WO", w.woNo], ["Campaign", w.campaignNo || "-"],
      ["Finish Good", fgKode(w.fgId)], ["Bulk code", w.bulkCode || "-"],
      ["Status", w.status], ["Started", w.startedAt || "-"], ["Done", w.doneAt || "-"]
    ], h, ["Diisi oleh (Produksi)", "Diperiksa oleh (QA)", "Disetujui oleh (Produksi Supervisor)"],
      "Rendemen must fall within 95-100%; outside that band a variance remark is mandatory."));
  }

  return { list: list, printBmr: printBmr, printBtip: printBtip, printPackWo: printPackWo };
})();
