/* ============================================================
   VIEWS - Warehouse (inbound lots, stock ledger, staging)
   Three surfaces over the Phase 3 ledger:
     1. Inventory lots - goods received into Quarantine, released
        or rejected by QA (rbac.js lot machine). Only Released lots
        may be staged.
     2. Kartu Stock - the append-only ledger per material with a
        running balance; SOH is the cached materials.stock_qty,
        allocated is the sum of Reserved staging lines.
     3. Staging - FR-PP-01 (raw) / FR-PP-04 (packaging) pick lists
        allocated FIFO across Released lots; dispensing posts the
        ISSUE and prints the FR-PP-10 weighing identification tag.
   ============================================================ */
window.ViewsWarehouse = (function () {

  var lotFilter = { q: "", status: "" };

  function lotPill(status) {
    var cls = status === "Released" ? "aktif" : status === "Rejected" ? "nonaktif" : "pending";
    return UI.el("span", { class: "pill " + cls, text: status || "Quarantine" });
  }
  function stgPill(status) {
    var cls = status === "Dispensed" ? "aktif" : status === "Cancelled" ? "nonaktif" : "info";
    return UI.el("span", { class: "pill " + cls, text: status || "Reserved" });
  }
  function matLabel(code) {
    var m = Store.matMap()[code] || {};
    return code + (m.name ? " - " + m.name : "");
  }

  /* ---------------- page ---------------- */
  function list(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("Warehouse",
      "Receive-driven inventory: quarantine lots with a QA release gate, the Kartu Stock ledger (SOH derived from receipts/issues), and FIFO staging pick lists that allocate stock to a work order.",
      []));
    root.appendChild(lotsCard(db));
    root.appendChild(kartuCard(db));
    root.appendChild(stagingCard(db));
  }

  /* ---------- 1. lots + QA release gate ---------- */
  function lotsCard(db) {
    var canQA = RBAC.canReleaseLot();
    var search = UI.input({ placeholder: "Search lot / material / supplier ref...", value: lotFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Quarantine", "Quarantine"], ["Released", "Released"], ["Rejected", "Rejected"]], lotFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = lotFilter.q.toLowerCase();
      var rows = db.inventoryLots.filter(function (l) {
        if (lotFilter.status && l.status !== lotFilter.status) return false;
        if (!q) return true;
        return ((l.lotNo || "") + " " + (l.materialCode || "") + " " + (l.materialName || "") + " " +
          (l.coaRef || "") + " " + (l.halalRef || "")).toLowerCase().indexOf(q) >= 0;
      });
      var cols = [
        { label: "Lot / No. Analisa", cls: "mono", render: function (l) { return "<b>" + Engine.esc(l.lotNo || l.id) + "</b>"; } },
        { label: "Material", cls: "mono", key: "materialCode" },
        { label: "Name", key: "materialName" },
        { label: "On hand", cls: "num", render: function (l) { return Engine.fmtNum(l.qty) + " " + Engine.esc(l.uom || ""); } },
        { label: "Received", cls: "mono", render: function (l) { return Engine.esc(l.receivedAt || "-"); } },
        { label: "Expiry", cls: "mono", render: function (l) { return Engine.esc(l.expiry || "-"); } },
        { label: "COA / Halal", render: function (l) { return UI.el("span", { style: "font-size:11.5px", text: [l.coaRef, l.halalRef].filter(Boolean).join(" · ") || "-" }); } },
        { label: "Status", render: function (l) { return lotPill(l.status); } },
        { label: "", render: function (l) { return lotActions(l, canQA); } }
      ];
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No inventory lot yet. Receive a purchase order line to create one." }));
    }
    function lotActions(l, canQA) {
      var btns = [UI.btn("View", function () { viewLot(l); }, "btn-sm")];
      if (canQA && l.status === "Quarantine") {
        btns.push(UI.btn("Release", function () { releaseLot(l, "Released"); }, "btn-sm btn-primary"));
        btns.push(UI.btn("Reject", function () { releaseLot(l, "Rejected"); }, "btn-sm btn-danger"));
      }
      return UI.el("div", { class: "btn-row" }, btns);
    }
    search.addEventListener("input", function () { lotFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { lotFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Inventory lots (QA release gate)" }),
      canQA ? null : UI.el("span", { class: "hint", text: "QA disposition is read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.inventoryLots.length + " lots" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }
  function releaseLot(lot, status) {
    var verb = status === "Released" ? "Release" : "Reject";
    var msg = verb + " lot " + (lot.lotNo || lot.id) + " (" + lot.materialCode + ", " + Engine.fmtNum(lot.qty) + " " + (lot.uom || "") + ")?" +
      (status === "Rejected" ? " Rejected stock is written off the ledger." : " Released lots become available for staging.");
    UI.confirmDialog(msg, function () {
      if (Store.setLotStatus(lot.id, status)) { App.refresh(); UI.toast("Lot " + status.toLowerCase(), "ok"); }
      else UI.toast("QA disposition not allowed for your role", "err");
    }, verb + " lot");
  }
  function viewLot(l) {
    var po = l.poId ? Store.poById(l.poId) : null;
    var rows = Store.ledgerFor(l.materialCode).filter(function (x) { return x.txn.lotId === l.id; });
    UI.modal({
      title: "Lot " + (l.lotNo || l.id),
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "Status" }), UI.el("dd", {}, [lotPill(l.status)]),
          UI.el("dt", { text: "Material" }), UI.el("dd", { class: "mono", text: matLabel(l.materialCode) }),
          UI.el("dt", { text: "On hand" }), UI.el("dd", { text: Engine.fmtNum(l.qty) + " " + (l.uom || "") }),
          UI.el("dt", { text: "Received qty" }), UI.el("dd", { text: Engine.fmtNum(l.qtyReceived) + " " + (l.uom || "") }),
          UI.el("dt", { text: "Received" }), UI.el("dd", { class: "mono", text: l.receivedAt || "-" }),
          UI.el("dt", { text: "Expiry" }), UI.el("dd", { class: "mono", text: l.expiry || "-" }),
          UI.el("dt", { text: "Source PO" }), UI.el("dd", { class: "mono", text: po ? (po.poNo + " / " + (po.supplier || "-")) : "-" }),
          UI.el("dt", { text: "COA ref" }), UI.el("dd", { text: l.coaRef || "-" }),
          UI.el("dt", { text: "Halal ref" }), UI.el("dd", { text: l.halalRef || "-" }),
          UI.el("dt", { text: "MSDS ref" }), UI.el("dd", { text: l.msdsRef || "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: l.note || "-" })
        ]),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin-bottom:4px", text: "Lot movement" }),
        UI.table([
          { label: "When", cls: "mono", render: function (x) { return Engine.esc(x.txn.txnAt || "-"); } },
          { label: "Type", render: function (x) { return UI.tag(x.txn.txnType); } },
          { label: "Qty", cls: "num", render: function (x) { return Engine.fmtNum(x.txn.qty); } },
          { label: "Ref", cls: "mono", render: function (x) { return Engine.esc((x.txn.refType || "") + (x.txn.refId ? " " + x.txn.refId : "")); } }
        ], rows, { emptyText: "No movement on this lot." })
      ]),
      actions: []
    });
  }

  /* ---------- 2. Kartu Stock (ledger per material) ---------- */
  function kartuCard(db) {
    var mats = db.materials.slice().sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
    var iMat = UI.combo([["", "(select a material)"]].concat(mats.map(function (m) {
      return [m.code, m.code + " - " + (m.name || "") + " (" + (m.unit || "") + ")"];
    })), "", "Type to search material...");
    var summary = UI.el("div", { class: "kv", style: "margin:6px 0 10px" });
    var bodyWrap = UI.el("div");

    function render() {
      var code = iMat.value;
      UI.clear(summary); UI.clear(bodyWrap);
      if (!code) { bodyWrap.appendChild(UI.el("div", { class: "hint", style: "color:var(--muted)", text: "Pick a material to see its Kartu Stock." })); return; }
      var m = Store.matMap()[code] || {};
      var soh = Store.sohOf(code), alloc = Store.allocatedOf(code), avail = Store.availableOf(code), open = Store.openingOf(code);
      [["Stock on hand (SOH)", Engine.fmtNum(soh) + " " + (m.unit || "")],
       ["Opening balance", Engine.fmtNum(open) + " " + (m.unit || "")],
       ["Allocated (reserved)", Engine.fmtNum(alloc) + " " + (m.unit || "")],
       ["Available (SOH - allocated)", Engine.fmtNum(avail) + " " + (m.unit || "")]
      ].forEach(function (p) {
        summary.appendChild(UI.el("dt", { text: p[0] }));
        summary.appendChild(UI.el("dd", { text: p[1] }));
      });
      var rows = Store.ledgerFor(code);
      bodyWrap.appendChild(UI.table([
        { label: "When", cls: "mono", render: function (x) { return Engine.esc(x.txn.txnAt || "-"); } },
        { label: "Type", render: function (x) { return UI.tag(x.txn.txnType); } },
        { label: "Lot", cls: "mono", render: function (x) { var l = x.txn.lotId ? Store.lotById(x.txn.lotId) : null; return Engine.esc(l ? (l.lotNo || l.id) : "-"); } },
        { label: "Ref", cls: "mono", render: function (x) { return Engine.esc((x.txn.refType || "") + (x.txn.refId ? " " + x.txn.refId : "")); } },
        { label: "In / Out", cls: "num", render: function (x) {
          var q = Number(x.txn.qty) || 0;
          return q < 0 ? "<span style='color:var(--red)'>" + Engine.fmtNum(q) + "</span>" : "<span style='color:var(--green)'>+" + Engine.fmtNum(q) + "</span>";
        } },
        { label: "Balance", cls: "num", render: function (x) { return "<b>" + Engine.fmtNum(x.balance) + "</b>"; } },
        { label: "Note", render: function (x) { return Engine.esc(x.txn.note || ""); } }
      ], rows, { emptyText: "No ledger entry - the opening balance is the current SOH." }));
    }
    iMat.addEventListener("change", render);

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Kartu Stock (stock ledger)" })]));
    card.appendChild(UI.el("div", { class: "card-body" }, [
      UI.field("Material", iMat, "SOH is derived from the append-only ledger; allocated is the sum of Reserved staging lines."),
      summary, bodyWrap
    ]));
    render();
    return card;
  }

  /* ---------- 3. staging pick lists (FR-PP-01 / 04 / 10) ---------- */
  function stagingCard(db) {
    var canStage = RBAC.canStage();
    var wos = db.workOrdersBulk.filter(function (w) { return w.status === "Planned" || w.status === "Released"; });
    var iWo = UI.combo([["", "(no work order / manual pick)"]].concat(wos.map(function (w) {
      var f = Store.fgById(w.fgId);
      return [w.id, (w.campaignNo || w.woNo) + " · batch " + w.batchSeq + " · " + (f ? f.kodeFG : (w.fgId || "-")) + " · " + Engine.fmtNum(w.plannedKg, 0) + " kg"];
    })), "", "Type to search work order...");
    var iType = UI.select([["FR-PP-01", "FR-PP-01 (raw material)"], ["FR-PP-04", "FR-PP-04 (packaging)"]], "FR-PP-01");
    var mats = db.materials.slice().sort(function (a, b) { return String(a.code).localeCompare(String(b.code)); });
    var iMat = UI.combo([["", "(select a material)"]].concat(mats.map(function (m) {
      return [m.code, m.code + " - " + (m.name || "") + " (" + (m.unit || "") + ")  avail " + Engine.fmtNum(Store.availableOf(m.code))];
    })), "", "Material to stage...");
    var iQty = UI.input({ type: "number", step: "0.0001", min: "0", value: "", style: "width:140px" });

    var pending = [];
    var pendWrap = UI.el("div");
    function drawPending() {
      UI.clear(pendWrap);
      if (!pending.length) { pendWrap.appendChild(UI.el("div", { class: "hint", style: "color:var(--muted)", text: "No pick line added yet." })); return; }
      pendWrap.appendChild(UI.table([
        { label: "Material", cls: "mono", key: "materialCode" },
        { label: "Name", key: "materialName" },
        { label: "Qty", cls: "num", render: function (p) { return Engine.fmtNum(p.qty) + " " + Engine.esc(p.uom || ""); } },
        { label: "", render: function (p) {
          return UI.btn("Remove", function () { pending = pending.filter(function (x) { return x !== p; }); drawPending(); }, "btn-sm btn-danger");
        } }
      ], pending, { emptyText: "" }));
    }
    function addLine() {
      var code = iMat.value, qty = Number(iQty.value) || 0;
      if (!code) { UI.toast("Select a material", "err"); return; }
      if (qty <= 0) { UI.toast("Quantity must be positive", "err"); return; }
      var m = Store.matMap()[code] || {};
      pending.push({ materialCode: code, materialName: m.name || "", qty: qty, uom: m.unit || "" });
      iQty.value = ""; drawPending();
    }

    var linesWrap = UI.el("div");
    function drawLines() {
      UI.clear(linesWrap);
      var cols = [
        { label: "Staging No", cls: "mono", render: function (s) { return "<b>" + Engine.esc(s.stagingNo) + "</b>"; } },
        { label: "Doc", render: function (s) { return UI.tag(s.docType); } },
        { label: "Material", cls: "mono", key: "materialCode" },
        { label: "Lot", cls: "mono", render: function (s) { return Engine.esc(s.lotNo || "-"); } },
        { label: "Qty", cls: "num", render: function (s) { return Engine.fmtNum(s.qty) + " " + Engine.esc(s.uom || ""); } },
        { label: "Campaign", cls: "mono", render: function (s) { return Engine.esc(s.campaignNo || "-"); } },
        { label: "Status", render: function (s) { return stgPill(s.status); } },
        { label: "", render: function (s) { return stgActions(s, canStage); } }
      ];
      linesWrap.appendChild(UI.table(cols, db.stagings, { emptyText: "No staging pick list yet." }));
    }
    function stgActions(s, canStage) {
      var btns = [];
      if (canStage && s.status === "Reserved") {
        btns.push(UI.btn("Dispense", function () { dispense(s); }, "btn-sm btn-primary"));
        btns.push(UI.btn("Cancel", function () {
          UI.confirmDialog("Cancel staging line " + s.stagingNo + " / " + s.materialCode + "? The reservation is released.", function () {
            Store.cancelStaging(s.id); App.refresh(); UI.toast("Reservation cancelled", "ok");
          });
        }, "btn-sm btn-danger"));
      }
      btns.push(UI.btn("Pick list", function () { printStaging(s.stagingNo); }, "btn-sm"));
      btns.push(UI.btn("Tag (FR-PP-10)", function () { printTag(s); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function dispense(s) {
      UI.confirmDialog("Dispense " + Engine.fmtNum(s.qty) + " " + (s.uom || "") + " of " + s.materialCode +
        " from lot " + (s.lotNo || "-") + "? This posts the ISSUE to the ledger and prints the FR-PP-10 tag.", function () {
        if (Store.dispenseStaging(s.id)) { App.refresh(); UI.toast("Dispensed - FR-PP-10 tag ready", "ok"); printTag(Store.stagingById(s.id)); }
        else UI.toast("Dispense failed", "err");
      }, "Dispense & weigh");
    }
    function createPick() {
      if (!canStage) { UI.toast("Only Warehouse / Production may stage materials", "err"); return; }
      if (!pending.length) { UI.toast("Add at least one pick line", "err"); return; }
      var wo = iWo.value ? Store.get().workOrdersBulk.filter(function (w) { return w.id === iWo.value; })[0] : null;
      /* FIFO-allocate every requested line across Released lots */
      var picks = [], shortages = [];
      pending.forEach(function (p) {
        var r = Store.fifoPick(p.materialCode, p.qty);
        picks = picks.concat(r.picks);
        if (r.short > 0) shortages.push(p.materialCode + " short " + Engine.fmtNum(r.short) + " " + (p.uom || ""));
      });
      if (!picks.length) { UI.toast("No Released lot with free stock to pick - release quarantine stock first", "err"); return; }
      var res = Store.createStaging({
        woId: wo ? wo.id : "", campaignNo: wo ? wo.campaignNo : "", fgId: wo ? wo.fgId : "",
        docType: iType.value, picks: picks, date: Engine.todayISO()
      });
      pending = []; drawPending();
      App.refresh();
      UI.toast("Staging " + res.stagingNo + " created (" + res.count + " line(s))" +
        (shortages.length ? " - WARNING: " + shortages.join("; ") : ""), shortages.length ? "err" : "ok");
    }

    var builder = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Work order / campaign", iWo, "Optional - links the allocation to a bulk batch for traceability."),
        UI.field("Document type", iType)
      ]),
      UI.el("div", { class: "toolbar", style: "margin:4px 0" }, [
        iMat, iQty, UI.btn("Add pick line", addLine, ""), UI.el("div", { class: "spacer" }),
        canStage ? UI.btn("Create staging pick list", createPick, "btn-primary") : null
      ]),
      pendWrap
    ]);

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Staging pick lists (FR-PP-01 / FR-PP-04 / FR-PP-10)" }),
      canStage ? null : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "card-body" }, [
      builder,
      UI.el("div", { style: "font-weight:700;font-size:12.5px;margin:12px 0 4px", text: "Staged lines" }),
      linesWrap
    ]));
    drawPending(); drawLines();
    return card;
  }

  /* ---------------- print: pick list (FR-PP-01 / FR-PP-04) ---------------- */
  function printStaging(stagingNo) {
    var db = Store.get();
    var lines = db.stagings.filter(function (s) { return s.stagingNo === stagingNo; });
    if (!lines.length) { UI.toast("No lines for " + stagingNo, "err"); return; }
    var first = lines[0];
    var f = first.fgId ? Store.fgById(first.fgId) : null;
    var title = first.docType === "FR-PP-04" ? "PACKAGING STAGING / PICK LIST (FR-PP-04)" : "RAW MATERIAL STAGING / PICK LIST (FR-PP-01)";
    var info = [
      ["Staging No", stagingNo], ["Doc type", first.docType],
      ["Campaign / WO", first.campaignNo || "-"], ["Finish Good", f ? f.kodeFG : (first.fgId || "-")],
      ["Date", Engine.todayISO()], ["Lines", String(lines.length)]
    ];
    var rows = lines.map(function (s, i) {
      return "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + Engine.esc(s.materialCode) + "</td>" +
        "<td>" + Engine.esc(s.materialName || "") + "</td><td class='c'>" + Engine.esc(s.lotNo || "-") + "</td>" +
        "<td class='r'>" + Engine.fmtNum(s.qty) + "</td><td class='c'>" + Engine.esc(s.uom || "") + "</td>" +
        "<td class='c'>" + Engine.esc(s.status) + "</td><td class='c'>" + Engine.esc(s.weighedBy || "-") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:5%'>No</th><th style='width:15%'>Material</th><th>Description</th>" +
      "<th style='width:16%'>Lot / No. Analisa</th><th style='width:11%'>Qty</th><th style='width:8%'>UoM</th>" +
      "<th style='width:12%'>Status</th><th style='width:14%'>Weighed by</th></tr>" + rows + "</table>";
    UI.printHTML(UI.docShell(title, info, h,
      ["Disiapkan oleh (Warehouse)", "Diperiksa oleh (QA)", "Diterima oleh (Produksi)"], ""));
  }

  /* ---------------- print: weighing identification tag (FR-PP-10) ---------------- */
  function printTag(s) {
    if (!s) return;
    var f = s.fgId ? Store.fgById(s.fgId) : null;
    var info = [
      ["Material code", s.materialCode], ["Material name", s.materialName || "-"],
      ["Lot / No. Analisa", s.lotNo || "-"], ["Qty weighed", Engine.fmtNum(s.qty) + " " + (s.uom || "")],
      ["Staging No", s.stagingNo], ["Doc type", s.docType],
      ["Campaign / WO", s.campaignNo || "-"], ["Finish Good", f ? f.kodeFG : (s.fgId || "-")],
      ["Weighed by", s.weighedBy || "-"], ["Weighed at", s.weighedAt || "-"],
      ["Status", s.status]
    ];
    var h = "<table class='lines'><tr><th style='width:20%'>Lot / No. Analisa</th><th style='width:20%'>Qty</th>" +
      "<th style='width:20%'>UoM</th><th>Material</th></tr>" +
      "<tr><td class='c'><b>" + Engine.esc(s.lotNo || "-") + "</b></td><td class='r'><b>" + Engine.fmtNum(s.qty) + "</b></td>" +
      "<td class='c'>" + Engine.esc(s.uom || "") + "</td><td>" + Engine.esc(s.materialCode) + " - " + Engine.esc(s.materialName || "") + "</td></tr></table>";
    UI.printHTML(UI.docShell("WEIGHING IDENTIFICATION TAG (FR-PP-10)", info, h,
      ["Ditimbang oleh", "Diperiksa oleh (QA)", "Diketahui oleh (Produksi)"],
      "Affix this tag to the dispensed container before transfer to production."));
  }

  return { list: list, printStaging: printStaging, printTag: printTag };
})();
