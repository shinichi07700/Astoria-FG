/* ============================================================
   VIEWS - FG warehouse & outbound logistics (Phase 5)
   Three surfaces over the finished-goods ledger:
     1. FG receipts (FR-PR-02) - created from an APPROVED pack work
        order; backflushes the component lots FIFO, opens the FG lot
        and posts a RECEIPT to the Kartu Stock Barang Jadi.
     2. Kartu Stock Barang Jadi - the append-only FG ledger per kode
        with a running balance; SOH is derived (no opening balance).
     3. Surat Jalan (delivery orders) - outbound against a CONFIRMED
        sales order; FIFO-picks FG lots, and closing draws the stock
        down and closes the SO once it is fully delivered.
   ============================================================ */
window.ViewsLogistics = (function () {

  var fgrFilter = { q: "" };
  var sjFilter = { q: "", status: "" };

  function doPill(s) {
    var cls = s === "Closed" ? "aktif" : s === "Void" ? "nonaktif" : "info";
    return UI.el("span", { class: "pill " + cls, text: s || "Open" });
  }
  function fgLabel(fgId, kodeFg) {
    var f = fgId ? Store.fgById(fgId) : null;
    return (f ? f.kodeFG : (kodeFg || fgId || "-"));
  }

  /* pack WOs already received into FG stock (one receipt per pack WO) */
  function receivedPacks(db) {
    var s = {};
    db.fgReceipts.forEach(function (r) { if (r.woPackId) s[String(r.woPackId)] = true; });
    return s;
  }
  /* Done pack WOs with an Approved release that are not yet received */
  function eligiblePacks(db) {
    var done = receivedPacks(db);
    return db.workOrdersPack.filter(function (p) {
      return p.status === "Done" && Store.releaseApproved(p.id) && !done[String(p.id)];
    });
  }
  function deliverableSos(db) {
    return db.salesOrders.filter(function (so) {
      return so.status === "Confirmed" && Store.soRemainingQty(so.id) > 0;
    });
  }

  /* ---------------- page ---------------- */
  function list(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("FG & Logistics",
      "Receive an approved packing batch into finished-goods stock (FR-PR-02 backflushes the component lots and posts the Kartu Stock Barang Jadi), then ship it out on a Surat Jalan against a confirmed sales order - closing the SJ draws FG stock down and closes the SO once fully delivered.",
      []));
    root.appendChild(fgReceiptCard(db));
    root.appendChild(kartuFgCard(db));
    root.appendChild(sjCard(db));
    if (!RBAC.canReceiveFg() && !RBAC.canDeliver()) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - Warehouse/Production receive FG stock and Warehouse ships it." }));
  }

  /* ---------- 1. FG receipts (FR-PR-02) ---------- */
  function fgReceiptCard(db) {
    var canRcv = RBAC.canReceiveFg();
    var search = UI.input({ placeholder: "Search receipt / finish good / batch...", value: fgrFilter.q });
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = fgrFilter.q.toLowerCase();
      var rows = db.fgReceipts.filter(function (r) {
        if (!q) return true;
        return ((r.receiptNo || "") + " " + (r.kodeFg || "") + " " + (r.batchLot || "") + " " + (r.campaignNo || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Receipt No", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.receiptNo) + "</b>"; } },
        { label: "Finish Good", cls: "mono", render: function (r) { return Engine.esc(r.kodeFg || fgLabel(r.fgId)); } },
        { label: "Batch / Lot", cls: "mono", render: function (r) { return Engine.esc(r.batchLot || "-"); } },
        { label: "Campaign", cls: "mono", render: function (r) { return Engine.esc(r.campaignNo || "-"); } },
        { label: "Received", cls: "num", render: function (r) { return Engine.fmtNum(r.qty, 0) + " " + Engine.esc(r.uom || ""); } },
        { label: "On hand", cls: "num", render: function (r) { return "<b>" + Engine.fmtNum(r.qtyOnHand, 0) + "</b>"; } },
        { label: "Backflush", cls: "num", render: function (r) { return (r.backflush || []).length + " line(s)"; } },
        { label: "", render: function (r) { return rcvActions(r); } }
      ], rows, { emptyText: "No FG receipt yet. Receive an approved, done packing work order." }));
    }
    function rcvActions(r) {
      return UI.el("div", { class: "btn-row" }, [
        UI.btn("View", function () { viewReceipt(r); }, "btn-sm"),
        UI.btn("Print", function () { printFgReceipt(r.receiptNo); }, "btn-sm")
      ]);
    }
    search.addEventListener("input", function () { fgrFilter.q = search.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "FG receipts (FR-PR-02)" }),
      canRcv ? UI.btn("New FG receipt", receiptEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.fgReceipts.length + " receipts" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }

  function receiptEditor() {
    if (!RBAC.canReceiveFg()) { UI.toast("Only Warehouse / Production may receive FG stock", "err"); return; }
    var db = Store.get();
    var packs = eligiblePacks(db);
    if (!packs.length) { UI.toast("No done pack WO with an Approved release to receive", "err"); return; }
    var opts = [["", "(select an approved packing WO)"]].concat(packs.map(function (p) {
      return [p.id, (p.woNo || p.id) + " · " + fgLabel(p.fgId) + " · yield " + Engine.fmtNum(p.actualYield, 0) + " " + (p.outputUnit || "pcs") + " · " + (p.campaignNo || "-")];
    }));
    var iWo = UI.combo(opts, "", "Type to search packing WO...");
    var iQty = UI.input({ type: "number", step: "1", min: "0", value: "", style: "width:150px", placeholder: "auto = actual yield" });
    var iBatch = UI.input({ value: "", placeholder: "auto from release / bulk code" });
    var iExp = UI.input({ type: "date", value: "" });
    var iNote = UI.input({ value: "", placeholder: "Note" });
    var preview = UI.el("div", { class: "hint", style: "margin-top:6px" });
    function updatePreview() {
      UI.clear(preview);
      var p = packs.filter(function (x) { return String(x.id) === String(iWo.value); })[0];
      if (!p) { preview.textContent = "Pick an approved packing work order to preview the backflush."; return; }
      var qty = Number(iQty.value) || Number(p.actualYield) || 0;
      var req = Store.backflushRequirement(p.fgId, qty, p.bulkWoId);
      preview.textContent = req.length
        ? "Backflush will issue " + req.length + " component line(s) FIFO (net of staging already dispensed)."
        : "No BOM / component requirement to backflush for this FG.";
    }
    iWo.addEventListener("change", updatePreview);
    iQty.addEventListener("input", updatePreview);
    updatePreview();
    UI.modal({
      title: "New FG receipt (FR-PR-02)", wide: true,
      body: UI.el("div", {}, [
        UI.field("Approved packing WO", iWo, "Only a Done pack WO whose release (FR-QC-06) is Approved may be received."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Received qty", iQty, "Defaults to the pack WO actual yield."),
          UI.field("Batch / lot", iBatch),
          UI.field("Expiry", iExp),
          UI.field("Note", iNote)
        ]),
        preview
      ]),
      actions: [{
        label: "Receive into FG stock", cls: "btn-primary", onClick: function () {
          if (!iWo.value) { UI.toast("Select a packing work order", "err"); return; }
          var res = Store.createFgReceipt({
            woPackId: iWo.value, qty: iQty.value === "" ? null : Number(iQty.value),
            batchLot: iBatch.value.trim(), expiry: iExp.value || "", note: iNote.value.trim()
          });
          if (res.error) { UI.toast(res.error, "err"); return; }
          UI.closeModal(); App.refresh();
          UI.toast("FG receipt " + res.receipt.receiptNo + " created - " + Engine.fmtNum(res.receipt.qty, 0) + " " + res.receipt.uom + " into Kartu Stock", "ok");
        }
      }]
    });
  }

  function viewReceipt(r) {
    var pack = r.woPackId ? Store.packWoById(r.woPackId) : null;
    var rel = r.releaseId ? Store.releaseById(r.releaseId) : null;
    var moves = Store.fgLedgerFor(r.kodeFg).filter(function (x) { return String(x.txn.fgReceiptId) === String(r.id); });
    UI.modal({
      title: "FG receipt " + r.receiptNo, wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: r.kodeFg || fgLabel(r.fgId) }),
          UI.el("dt", { text: "Batch / lot" }), UI.el("dd", { class: "mono", text: r.batchLot || "-" }),
          UI.el("dt", { text: "Campaign" }), UI.el("dd", { class: "mono", text: r.campaignNo || "-" }),
          UI.el("dt", { text: "Received" }), UI.el("dd", { text: Engine.fmtNum(r.qty, 0) + " " + (r.uom || "") }),
          UI.el("dt", { text: "On hand" }), UI.el("dd", { text: Engine.fmtNum(r.qtyOnHand, 0) + " " + (r.uom || "") }),
          UI.el("dt", { text: "Expiry" }), UI.el("dd", { class: "mono", text: r.expiry || "-" }),
          UI.el("dt", { text: "Produced at" }), UI.el("dd", { class: "mono", text: r.producedAt || "-" }),
          UI.el("dt", { text: "Received by" }), UI.el("dd", { text: r.receivedBy || "-" }),
          UI.el("dt", { text: "Source pack WO" }), UI.el("dd", { class: "mono", text: pack ? (pack.woNo + " (rendemen " + Engine.fmtNum(pack.rendemenPct, 2) + "%)") : "-" }),
          UI.el("dt", { text: "Release (FR-QC-06)" }), UI.el("dd", { class: "mono", text: rel ? (rel.releaseNo + " - " + rel.disposition) : "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: r.note || "-" })
        ]),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin-bottom:4px", text: "Backflush (component consumption, FIFO)" }),
        UI.table([
          { label: "Material", cls: "mono", key: "materialCode" },
          { label: "Name", key: "materialName" },
          { label: "Section", render: function (b) { return UI.tag(b.section || "-"); } },
          { label: "Required", cls: "num", render: function (b) { return Engine.fmtNum(b.required); } },
          { label: "Staged", cls: "num", render: function (b) { return Engine.fmtNum(b.dispensed); } },
          { label: "Issued", cls: "num", render: function (b) { return Engine.fmtNum(b.issued || 0); } },
          { label: "Short", cls: "num", render: function (b) { return b.short > 0 ? "<span style='color:var(--red)'>" + Engine.fmtNum(b.short) + "</span>" : "-"; } },
          { label: "UoM", render: function (b) { return Engine.esc(b.uom || ""); } }
        ], r.backflush || [], { emptyText: "No component backflushed (no BOM or nothing owing)." }),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin:12px 0 4px", text: "FG ledger entries for this batch" }),
        UI.table([
          { label: "When", cls: "mono", render: function (x) { return Engine.esc(x.txn.txnAt || "-"); } },
          { label: "Type", render: function (x) { return UI.tag(x.txn.txnType); } },
          { label: "Qty", cls: "num", render: function (x) { return Engine.fmtNum(x.txn.qty); } },
          { label: "Balance", cls: "num", render: function (x) { return "<b>" + Engine.fmtNum(x.balance) + "</b>"; } }
        ], moves, { emptyText: "No ledger entry." })
      ]),
      actions: [{ label: "Print FR-PR-02", onClick: function () { UI.closeModal(); printFgReceipt(r.receiptNo); } }]
    });
  }

  /* ---------- 2. Kartu Stock Barang Jadi (FG ledger) ---------- */
  function kartuFgCard(db) {
    var codes = {};
    db.fgReceipts.forEach(function (r) { if (r.kodeFg) codes[r.kodeFg] = r.fgId; });
    var opts = [["", "(select a finish good)"]].concat(Object.keys(codes).sort().map(function (code) {
      var f = Store.fgById(codes[code]);
      return [code, code + (f && f.deskripsi ? " - " + f.deskripsi : "") + "  (SOH " + Engine.fmtNum(Store.fgSoh(code), 0) + ")"];
    }));
    var iFg = UI.combo(opts, "", "Type to search finish good...");
    var summary = UI.el("div", { class: "kv", style: "margin:6px 0 10px" });
    var bodyWrap = UI.el("div");
    function render() {
      var code = iFg.value;
      UI.clear(summary); UI.clear(bodyWrap);
      if (!code) { bodyWrap.appendChild(UI.el("div", { class: "hint", style: "color:var(--muted)", text: "Pick a finish good to see its Kartu Stock Barang Jadi." })); return; }
      var soh = Store.fgSoh(code);
      var reserved = db.deliveryLines.reduce(function (a, l) {
        var d = Store.deliveryById(l.doId);
        return (d && d.status === "Open" && l.kodeFg === code) ? a + (Number(l.qty) || 0) : a;
      }, 0);
      [["Finished-goods SOH", Engine.fmtNum(soh, 0) + " pcs"],
       ["Reserved on open Surat Jalan", Engine.fmtNum(reserved, 0) + " pcs"],
       ["Available to ship", Engine.fmtNum(Math.max(0, Engine.round4(soh - reserved)), 0) + " pcs"]
      ].forEach(function (p) {
        summary.appendChild(UI.el("dt", { text: p[0] }));
        summary.appendChild(UI.el("dd", { text: p[1] }));
      });
      var rows = Store.fgLedgerFor(code);
      bodyWrap.appendChild(UI.table([
        { label: "When", cls: "mono", render: function (x) { return Engine.esc(x.txn.txnAt || "-"); } },
        { label: "Type", render: function (x) { return UI.tag(x.txn.txnType); } },
        { label: "Batch", cls: "mono", render: function (x) { var r = x.txn.fgReceiptId ? Store.fgReceiptById(x.txn.fgReceiptId) : null; return Engine.esc(r ? (r.batchLot || "-") : "-"); } },
        { label: "Ref", cls: "mono", render: function (x) { return Engine.esc((x.txn.refType || "") + (x.txn.refId ? " " + x.txn.refId : "")); } },
        { label: "In / Out", cls: "num", render: function (x) {
          var q = Number(x.txn.qty) || 0;
          return q < 0 ? "<span style='color:var(--red)'>" + Engine.fmtNum(q, 0) + "</span>" : "<span style='color:var(--green)'>+" + Engine.fmtNum(q, 0) + "</span>";
        } },
        { label: "Balance", cls: "num", render: function (x) { return "<b>" + Engine.fmtNum(x.balance, 0) + "</b>"; } },
        { label: "Note", render: function (x) { return Engine.esc(x.txn.note || ""); } }
      ], rows, { emptyText: "No finished-goods movement for this kode." }));
    }
    iFg.addEventListener("change", render);
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Kartu Stock Barang Jadi (FG ledger)" })]));
    card.appendChild(UI.el("div", { class: "card-body" }, [
      UI.field("Finish Good", iFg, "FG SOH is derived from the append-only ledger - there is no opening balance; stock only enters via an FR-PR-02 receipt."),
      summary, bodyWrap
    ]));
    render();
    return card;
  }

  /* ---------- 3. Surat Jalan (delivery orders) ---------- */
  function sjCard(db) {
    var canDel = RBAC.canDeliver();
    var search = UI.input({ placeholder: "Search SJ / SO / customer...", value: sjFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Open", "Open"], ["Closed", "Closed"], ["Void", "Void"]], sjFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = sjFilter.q.toLowerCase();
      var rows = db.deliveryOrders.filter(function (d) {
        if (sjFilter.status && d.status !== sjFilter.status) return false;
        if (!q) return true;
        return ((d.sjNo || "") + " " + (d.customerName || "") + " " + (d.kodeFg || "") + " " + (soNo(d.soId))).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Surat Jalan", cls: "mono", render: function (d) { return "<b>" + Engine.esc(d.sjNo) + "</b>"; } },
        { label: "Sales Order", cls: "mono", render: function (d) { return Engine.esc(soNo(d.soId)); } },
        { label: "Customer", render: function (d) { return Engine.esc(d.customerName || "-"); } },
        { label: "Finish Good", cls: "mono", render: function (d) { return Engine.esc(d.kodeFg || fgLabel(d.fgId)); } },
        { label: "Qty", cls: "num", render: function (d) { return Engine.fmtNum(Store.deliveryQty(d.id), 0); } },
        { label: "Delivered", cls: "mono", render: function (d) { return Engine.esc(d.deliveredAt || "-"); } },
        { label: "Status", render: function (d) { return doPill(d.status); } },
        { label: "", render: function (d) { return sjActions(d, canDel); } }
      ], rows, { emptyText: "No Surat Jalan yet. Ship a confirmed sales order from finished-goods stock." }));
    }
    function soNo(id) { var so = id ? Store.soById(id) : null; return so ? so.noSo : (id || "-"); }
    function sjActions(d, canDel) {
      var btns = [UI.btn("View", function () { viewSj(d); }, "btn-sm")];
      if (canDel && d.status === "Open") {
        RBAC.transitionsFrom("deliveryOrder", "Open").forEach(function (t) {
          if (t.to === "Closed") btns.push(UI.btn("Close / ship", function () { closeSj(d); }, "btn-sm btn-primary"));
          else if (t.to === "Void") btns.push(UI.btn("Void", function () { voidSj(d); }, "btn-sm btn-danger"));
        });
      }
      btns.push(UI.btn("Print SJ", function () { printSuratJalan(d.sjNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    function closeSj(d) {
      UI.confirmDialog("Close Surat Jalan " + d.sjNo + " (" + Engine.fmtNum(Store.deliveryQty(d.id), 0) + " pcs of " + d.kodeFg + ")? " +
        "This draws the FG lots down FIFO, posts the ISSUE to the Kartu Stock Barang Jadi and closes the sales order once fully delivered.", function () {
        if (Store.closeDeliveryOrder(d.id)) { App.refresh(); UI.toast("Surat Jalan closed - stock shipped", "ok"); }
        else UI.toast("Close not allowed for your role", "err");
      }, "Close & ship");
    }
    function voidSj(d) {
      UI.confirmDialog("Void Surat Jalan " + d.sjNo + "? The reserved finished-goods stock is released.", function () {
        if (Store.voidDeliveryOrder(d.id)) { App.refresh(); UI.toast("Surat Jalan voided", "ok"); }
        else UI.toast("Void not allowed for your role", "err");
      }, "Void SJ");
    }
    search.addEventListener("input", function () { sjFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { sjFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Surat Jalan (delivery orders)" }),
      canDel ? UI.btn("New Surat Jalan", sjEditor, "btn-primary btn-sm") : UI.el("span", { class: "hint", text: "Read-only for your role" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.deliveryOrders.length + " documents" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }

  function sjEditor() {
    if (!RBAC.canDeliver()) { UI.toast("Only Warehouse may raise a Surat Jalan", "err"); return; }
    var db = Store.get();
    var sos = deliverableSos(db);
    if (!sos.length) { UI.toast("No confirmed sales order with remaining qty to deliver", "err"); return; }
    var opts = [["", "(select a confirmed sales order)"]].concat(sos.map(function (so) {
      var cust = so.customerId ? Store.customerById(so.customerId) : null;
      return [so.id, so.noSo + " · " + (cust ? cust.name : "-") + " · " + fgLabel(so.fgId) + " · remaining " + Engine.fmtNum(Store.soRemainingQty(so.id), 0)];
    }));
    var iSo = UI.combo(opts, "", "Type to search sales order...");
    var iQty = UI.input({ type: "number", step: "1", min: "1", value: "", style: "width:150px" });
    var iVehicle = UI.input({ value: "", placeholder: "B 1234 XYZ" });
    var iDriver = UI.input({ value: "", placeholder: "Driver name" });
    var iNote = UI.input({ value: "", placeholder: "Note" });
    var hint = UI.el("div", { class: "hint", style: "margin-top:6px" });
    function onSo() {
      var so = sos.filter(function (x) { return String(x.id) === String(iSo.value); })[0];
      if (so) { iQty.value = String(Store.soRemainingQty(so.id)); }
      UI.clear(hint);
      if (so) {
        var avail = Store.fgSoh(fgLabel(so.fgId));
        hint.textContent = "FG available for " + fgLabel(so.fgId) + ": " + Engine.fmtNum(avail, 0) +
          " pcs. The Surat Jalan FIFO-picks released FG batches; closing it draws the stock down.";
      }
    }
    iSo.addEventListener("change", onSo);
    UI.modal({
      title: "New Surat Jalan", wide: true,
      body: UI.el("div", {}, [
        UI.field("Sales order", iSo, "Only a Confirmed SO with remaining quantity may be delivered."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Ship qty", iQty, "Defaults to the SO remaining quantity."),
          UI.field("Vehicle", iVehicle),
          UI.field("Driver", iDriver),
          UI.field("Note", iNote)
        ]),
        hint
      ]),
      actions: [{
        label: "Create Surat Jalan", cls: "btn-primary", onClick: function () {
          if (!iSo.value) { UI.toast("Select a sales order", "err"); return; }
          var res = Store.createDeliveryOrder({
            soId: iSo.value, qty: Number(iQty.value) || 0,
            vehicle: iVehicle.value.trim(), driver: iDriver.value.trim(), note: iNote.value.trim()
          });
          if (res.error) { UI.toast(res.error, "err"); return; }
          UI.closeModal(); App.refresh();
          UI.toast("Surat Jalan " + res.do.sjNo + " created" + (res.short > 0 ? " - WARNING short " + Engine.fmtNum(res.short, 0) + " pcs (insufficient FG stock)" : ""),
            res.short > 0 ? "err" : "ok");
        }
      }]
    });
  }

  function viewSj(d) {
    var so = d.soId ? Store.soById(d.soId) : null;
    var lines = Store.deliveryLinesFor(d.id);
    UI.modal({
      title: "Surat Jalan " + d.sjNo, wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "Status" }), UI.el("dd", {}, [doPill(d.status)]),
          UI.el("dt", { text: "Sales Order" }), UI.el("dd", { class: "mono", text: so ? (so.noSo + " [" + so.status + "]") : (d.soId || "-") }),
          UI.el("dt", { text: "Customer" }), UI.el("dd", { text: d.customerName || "-" }),
          UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: d.kodeFg || fgLabel(d.fgId) }),
          UI.el("dt", { text: "Total qty" }), UI.el("dd", { text: Engine.fmtNum(Store.deliveryQty(d.id), 0) + " pcs" }),
          UI.el("dt", { text: "Vehicle" }), UI.el("dd", { class: "mono", text: d.vehicle || "-" }),
          UI.el("dt", { text: "Driver" }), UI.el("dd", { text: d.driver || "-" }),
          UI.el("dt", { text: "Delivered at" }), UI.el("dd", { class: "mono", text: d.deliveredAt || "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: d.note || "-" })
        ]),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin-bottom:4px", text: "Picked FG batches (FIFO)" }),
        UI.table([
          { label: "Batch / Lot", cls: "mono", render: function (l) { return Engine.esc(l.batchLot || "-"); } },
          { label: "Kode FG", cls: "mono", render: function (l) { return Engine.esc(l.kodeFg || "-"); } },
          { label: "Qty", cls: "num", render: function (l) { return Engine.fmtNum(l.qty, 0); } },
          { label: "UoM", render: function (l) { return Engine.esc(l.uom || "pcs"); } },
          { label: "FG receipt", cls: "mono", render: function (l) { var r = l.fgReceiptId ? Store.fgReceiptById(l.fgReceiptId) : null; return Engine.esc(r ? r.receiptNo : "-"); } }
        ], lines, { emptyText: "No pick line." })
      ]),
      actions: [{ label: "Print SJ", onClick: function () { UI.closeModal(); printSuratJalan(d.sjNo); } }]
    });
  }

  /* ---------------- print: FG receipt (FR-PR-02) ---------------- */
  function printFgReceipt(receiptNo) {
    var db = Store.get();
    var r = db.fgReceipts.filter(function (x) { return x.receiptNo === receiptNo; })[0];
    if (!r) { UI.toast("Receipt not found", "err"); return; }
    var pack = r.woPackId ? Store.packWoById(r.woPackId) : null;
    var rel = r.releaseId ? Store.releaseById(r.releaseId) : null;
    var info = [
      ["Receipt No (FR-PR-02)", r.receiptNo], ["Finish Good", r.kodeFg || fgLabel(r.fgId)],
      ["Batch / Lot", r.batchLot || "-"], ["Campaign", r.campaignNo || "-"],
      ["Qty received", Engine.fmtNum(r.qty, 0) + " " + (r.uom || "pcs")], ["Expiry", r.expiry || "-"],
      ["Source pack WO", pack ? pack.woNo : "-"], ["Release (FR-QC-06)", rel ? (rel.releaseNo + " - " + rel.disposition) : "-"],
      ["Received by", r.receivedBy || "-"], ["Received at", r.receivedAt || "-"]
    ];
    var rows = (r.backflush || []).map(function (b, i) {
      return "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + Engine.esc(b.materialCode) + "</td>" +
        "<td>" + Engine.esc(b.materialName || "") + "</td><td class='c'>" + Engine.esc(b.section || "") + "</td>" +
        "<td class='r'>" + Engine.fmtNum(b.required) + "</td><td class='r'>" + Engine.fmtNum(b.dispensed) + "</td>" +
        "<td class='r'>" + Engine.fmtNum(b.issued || 0) + "</td><td class='r'>" + Engine.fmtNum(b.short || 0) + "</td>" +
        "<td class='c'>" + Engine.esc(b.uom || "") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:5%'>No</th><th style='width:14%'>Material</th><th>Description</th>" +
      "<th style='width:10%'>Section</th><th style='width:10%'>Required</th><th style='width:9%'>Staged</th>" +
      "<th style='width:9%'>Issued</th><th style='width:8%'>Short</th><th style='width:8%'>UoM</th></tr>" +
      (rows || "<tr><td colspan='9' class='c'>No component backflushed.</td></tr>") + "</table>";
    UI.printHTML(UI.docShell("FINISHED GOODS RECEIPT (FR-PR-02)", info, h,
      ["Diterima oleh (Warehouse)", "Diperiksa oleh (QA)", "Disetujui oleh (PPIC)"],
      "Received into the Kartu Stock Barang Jadi; component lots backflushed FIFO net of staging already dispensed."));
  }

  /* ---------------- print: Surat Jalan (delivery order) ---------------- */
  function printSuratJalan(sjNo) {
    var db = Store.get();
    var d = db.deliveryOrders.filter(function (x) { return x.sjNo === sjNo; })[0];
    if (!d) { UI.toast("Surat Jalan not found", "err"); return; }
    var so = d.soId ? Store.soById(d.soId) : null;
    var lines = Store.deliveryLinesFor(d.id);
    var info = [
      ["Surat Jalan No", d.sjNo], ["Sales Order", so ? so.noSo : (d.soId || "-")],
      ["Customer", d.customerName || "-"], ["Finish Good", d.kodeFg || fgLabel(d.fgId)],
      ["Total qty", Engine.fmtNum(Store.deliveryQty(d.id), 0) + " pcs"], ["Vehicle", d.vehicle || "-"],
      ["Driver", d.driver || "-"], ["Status", d.status],
      ["Delivered at", d.deliveredAt || "-"], ["Date", Engine.todayISO()]
    ];
    var rows = lines.map(function (l, i) {
      return "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + Engine.esc(l.batchLot || "-") + "</td>" +
        "<td class='c'>" + Engine.esc(l.kodeFg || "") + "</td><td class='r'>" + Engine.fmtNum(l.qty, 0) + "</td>" +
        "<td class='c'>" + Engine.esc(l.uom || "pcs") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:8%'>No</th><th style='width:32%'>Batch / Lot</th>" +
      "<th style='width:30%'>Kode FG</th><th style='width:18%'>Qty</th><th style='width:12%'>UoM</th></tr>" +
      (rows || "<tr><td colspan='5' class='c'>No pick line.</td></tr>") + "</table>";
    UI.printHTML(UI.docShell("SURAT JALAN / DELIVERY ORDER", info, h,
      ["Dikirim oleh (Warehouse)", "Diperiksa oleh (Expedisi)", "Diterima oleh (Customer)"],
      "Goods shipped against the sales order above; FG stock drawn down FIFO on closure."));
  }

  return { list: list, printFgReceipt: printFgReceipt, printSuratJalan: printSuratJalan };
})();
