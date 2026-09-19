/* ============================================================
   VIEWS - Purchasing (FR-PP-14)
   Turns Open purchase-requisition lines (raised by PPIC netting)
   into a supplier Purchase Order, then receives each line into a
   Quarantine inventory lot (goods-in). Receipt posts a RECEIPT
   row to the stock ledger. PO status walks Open -> Partial ->
   Closed as lines are received (rbac.js purchaseOrder machine).
   ============================================================ */
window.ViewsPurchasing = (function () {

  var prFilter = { q: "", status: "Open" };
  var poFilter = { q: "", status: "" };

  function poPill(status) {
    var cls = status === "Closed" ? "aktif"
      : status === "Partial" ? "info"
      : status === "Cancelled" ? "nonaktif" : "pending";
    return UI.el("span", { class: "pill " + cls, text: status || "Open" });
  }
  function prPill(status) {
    var cls = status === "Ordered" ? "info" : status === "Cancelled" ? "nonaktif" : "pending";
    return UI.el("span", { class: "pill " + cls, text: status || "Open" });
  }
  function remaining(p) { return Math.max(0, Engine.round4((Number(p.qty) || 0) - (Number(p.receivedQty) || 0))); }

  /* ---------------- page ---------------- */
  function list(root) {
    var db = Store.get();
    var canBuy = RBAC.canPurchase(), canRcv = RBAC.canReceive();
    root.appendChild(UI.pageHead("Purchasing",
      "Raise a Purchase Order (FR-PP-14) from the open purchase requisitions PPIC produced, then receive each line into a Quarantine lot. Goods receipt posts to the stock ledger; QA releases the lot on the Warehouse page.",
      []));

    root.appendChild(prCard(db, canBuy));
    root.appendChild(poCard(db, canRcv));

    if (!canBuy && !canRcv) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - purchasing is run by Purchasing / Warehouse." }));
  }

  /* ---------- open requisitions -> create PO ---------- */
  function prCard(db, canBuy) {
    var sel = {};
    var search = UI.input({ placeholder: "Search req no / material / supplier...", value: prFilter.q });
    var fStatus = UI.select([["Open", "Open"], ["Ordered", "Ordered"], ["Cancelled", "Cancelled"], ["", "All"]], prFilter.status);
    var countLbl = UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: "" });

    var bodyWrap = UI.el("div");
    function currentRows() {
      var q = prFilter.q.toLowerCase();
      return db.purchaseReqs.filter(function (r) {
        if (prFilter.status && r.status !== prFilter.status) return false;
        if (!q) return true;
        return ((r.reqNo || "") + " " + (r.materialCode || "") + " " + (r.materialName || "") + " " + (r.supplier || "")).toLowerCase().indexOf(q) >= 0;
      });
    }
    function updateCount() {
      var n = Object.keys(sel).filter(function (k) { return sel[k]; }).length;
      countLbl.textContent = n + " selected";
    }
    function draw() {
      UI.clear(bodyWrap);
      var rows = currentRows();
      var cols = [];
      if (canBuy) cols.push({ label: "", render: function (r) {
        var cb = UI.el("input", { type: "checkbox" });
        cb.checked = !!sel[r.id];
        if (r.status !== "Open") cb.disabled = true;
        cb.addEventListener("change", function () { sel[r.id] = cb.checked; updateCount(); });
        return cb;
      } });
      cols = cols.concat([
        { label: "Req No", cls: "mono", render: function (r) { return Engine.esc(r.reqNo || "-"); } },
        { label: "Material", cls: "mono", key: "materialCode" },
        { label: "Name", key: "materialName" },
        { label: "Qty", cls: "num", render: function (r) { return "<b>" + Engine.fmtNum(r.qty) + "</b> " + Engine.esc(r.unit || ""); } },
        { label: "Supplier", render: function (r) { return Engine.esc(r.supplier || "-"); } },
        { label: "Required by", cls: "mono", render: function (r) { return Engine.esc(r.requiredBy || "-"); } },
        { label: "Status", render: function (r) { return prPill(r.status); } }
      ]);
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No purchase requisition lines. Run PPIC netting to raise the Astoria shortfall." }));
      updateCount();
    }
    search.addEventListener("input", function () { prFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { prFilter.status = fStatus.value; draw(); });

    var createBtn = canBuy ? UI.btn("Create PO from selected", function () {
      var ids = Object.keys(sel).filter(function (k) { return sel[k]; });
      if (!ids.length) { UI.toast("Select at least one open requisition line", "err"); return; }
      poEditor(ids);
    }, "btn-primary") : null;

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [
      UI.el("h3", { text: "Purchase requisitions (FR-PP-11)" }),
      UI.el("div", { class: "btn-row" }, createBtn ? [createBtn] : [])
    ]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }), countLbl]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }

  /* ---------- PO editor (from selected PR lines) ---------- */
  function poEditor(prIds) {
    if (!RBAC.canPurchase()) { UI.toast("Only Purchasing may raise a purchase order", "err"); return; }
    var db = Store.get();
    var lines = prIds.map(function (id) {
      return db.purchaseReqs.filter(function (r) { return String(r.id) === String(id); })[0];
    }).filter(Boolean);
    if (!lines.length) return;
    var firstSupplier = lines[0].supplier || "";

    var iSupplier = UI.input({ value: firstSupplier, placeholder: "Supplier name" });
    var iEta = UI.input({ type: "date" });
    var iLead = UI.input({ type: "number", step: "1", min: "0", value: "0" });
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "PO notes / terms" });

    var priceInputs = {};
    var linesWrap = UI.table([
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "materialName" },
      { label: "Qty", cls: "num", render: function (r) { return Engine.fmtNum(r.qty) + " " + Engine.esc(r.unit || ""); } },
      { label: "Unit price", render: function (r) {
        var inp = UI.input({ type: "number", step: "0.01", min: "0", value: "", style: "width:120px" });
        priceInputs[r.id] = inp; return inp;
      } }
    ], lines, { emptyText: "" });

    UI.modal({
      title: "New Purchase Order - " + lines.length + " line(s)",
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "form-grid" }, [
          UI.field("Supplier", iSupplier, "One supplier per PO; grouped from the requisition lines."),
          UI.field("ETA", iEta, "Expected arrival date."),
          UI.field("Lead time (days)", iLead)
        ]),
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin:8px 0 4px", text: "Order lines" }),
        linesWrap,
        UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Create Purchase Order", cls: "btn-primary", onClick: function () {
          var prices = {};
          Object.keys(priceInputs).forEach(function (k) { prices[k] = Number(priceInputs[k].value) || 0; });
          var res = Store.createPoFromPr(prIds, {
            supplier: iSupplier.value.trim(), eta: iEta.value || "",
            leadDays: Number(iLead.value) || 0, prices: prices, note: iNote.value.trim()
          });
          UI.closeModal(); App.refresh();
          UI.toast("Purchase order " + res.poNo + " created (" + res.count + " line(s))", "ok");
        }
      }]
    });
  }

  /* ---------- purchase orders + receipt ---------- */
  function poCard(db, canRcv) {
    var search = UI.input({ placeholder: "Search PO no / supplier / material...", value: poFilter.q });
    var fStatus = UI.select([["", "All statuses"], ["Open", "Open"], ["Partial", "Partial"], ["Closed", "Closed"], ["Cancelled", "Cancelled"]], poFilter.status);
    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = poFilter.q.toLowerCase();
      var rows = db.purchaseOrders.filter(function (p) {
        if (poFilter.status && p.status !== poFilter.status) return false;
        if (!q) return true;
        return ((p.poNo || "") + " " + (p.supplier || "") + " " + (p.materialCode || "") + " " + (p.materialName || "")).toLowerCase().indexOf(q) >= 0;
      });
      var cols = [
        { label: "PO No", cls: "mono", render: function (p) { return "<b>" + Engine.esc(p.poNo) + "</b>"; } },
        { label: "Supplier", render: function (p) { return Engine.esc(p.supplier || "-"); } },
        { label: "Material", cls: "mono", key: "materialCode" },
        { label: "Name", key: "materialName" },
        { label: "Ordered", cls: "num", render: function (p) { return Engine.fmtNum(p.qty) + " " + Engine.esc(p.unit || ""); } },
        { label: "Received", cls: "num", render: function (p) { return Engine.fmtNum(p.receivedQty || 0); } },
        { label: "Unit price", cls: "num", render: function (p) { return p.unitPrice ? Engine.fmtNum(p.unitPrice, 2) : "-"; } },
        { label: "ETA", cls: "mono", render: function (p) { return Engine.esc(p.eta || "-"); } },
        { label: "Status", render: function (p) { return poPill(p.status); } },
        { label: "", render: function (p) { return poActions(p, canRcv); } }
      ];
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No purchase order yet." + (canRcv ? "" : "") }));
    }
    function poActions(p, canRcv) {
      var btns = [];
      if (canRcv && (p.status === "Open" || p.status === "Partial")) {
        btns.push(UI.btn("Receive", function () { receiveEditor(p); }, "btn-sm btn-primary"));
      }
      btns.push(UI.btn("Print PO", function () { printPO(p.poNo); }, "btn-sm"));
      return UI.el("div", { class: "btn-row" }, btns);
    }
    search.addEventListener("input", function () { poFilter.q = search.value; draw(); });
    fStatus.addEventListener("change", function () { poFilter.status = fStatus.value; draw(); });

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-head" }, [UI.el("h3", { text: "Purchase orders (FR-PP-14)" })]));
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.purchaseOrders.length + " lines" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    draw();
    return card;
  }

  /* ---------- goods receipt -> Quarantine lot + RECEIPT ledger ---------- */
  function receiveEditor(p) {
    if (!RBAC.canReceive()) { UI.toast("Only Warehouse / Purchasing may receive stock", "err"); return; }
    var rem = remaining(p);
    var iQty = UI.input({ type: "number", step: "0.0001", min: "0", value: String(rem || "") });
    var iLot = UI.input({ value: "", placeholder: "No. Analisa / lot (CIKC...)" });
    var iExp = UI.input({ type: "date" });
    var iRcv = UI.input({ type: "date", value: Engine.todayISO() });
    var iCoa = UI.input({ value: "", placeholder: "COA ref" });
    var iHalal = UI.input({ value: "", placeholder: "Halal ref" });
    var iMsds = UI.input({ value: "", placeholder: "MSDS ref" });
    var iNote = UI.input({ value: "", placeholder: "Receipt note" });

    UI.modal({
      title: "Receive - " + p.poNo + " / " + p.materialCode,
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "hint", style: "margin-bottom:10px;color:var(--muted)",
          text: (p.materialName || "") + " - ordered " + Engine.fmtNum(p.qty) + " " + (p.unit || "") +
            ", already received " + Engine.fmtNum(p.receivedQty || 0) + ", remaining " + Engine.fmtNum(rem) + "." }),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Qty received (" + (p.unit || "") + ")", iQty, "Creates a Quarantine lot and posts a RECEIPT to the ledger."),
          UI.field("No. Analisa / lot", iLot, "Supplier lot / CIKC number printed on the FR-PP-10 tag."),
          UI.field("Received date", iRcv),
          UI.field("Expiry date", iExp),
          UI.field("COA ref", iCoa), UI.field("Halal ref", iHalal), UI.field("MSDS ref", iMsds)
        ]),
        UI.field("Note", iNote)
      ]),
      actions: [{
        label: "Receive into Quarantine", cls: "btn-primary", onClick: function () {
          var qty = Number(iQty.value) || 0;
          if (qty <= 0) { UI.toast("Received quantity must be positive", "err"); return; }
          var lot = Store.receivePoLine(p.id, {
            qty: qty, lotNo: iLot.value.trim(), receivedAt: iRcv.value || Engine.todayISO(),
            expiry: iExp.value || "", coaRef: iCoa.value.trim(), halalRef: iHalal.value.trim(),
            msdsRef: iMsds.value.trim(), note: iNote.value.trim()
          });
          if (!lot) { UI.toast("Receipt failed", "err"); return; }
          UI.closeModal(); App.refresh();
          UI.toast("Received " + Engine.fmtNum(qty, 2) + " " + (lot.uom || "") + " into lot " + (lot.lotNo || lot.id) + " (Quarantine)", "ok");
        }
      }]
    });
  }

  /* ---------------- print view (FR-PP-14) ---------------- */
  function printPO(poNo) {
    var db = Store.get();
    var lines = db.purchaseOrders.filter(function (p) { return p.poNo === poNo; });
    if (!lines.length) { UI.toast("No lines for " + poNo, "err"); return; }
    var first = lines[0];
    var total = lines.reduce(function (a, p) { return a + (Number(p.qty) || 0) * (Number(p.unitPrice) || 0); }, 0);
    var info = [
      ["PO No", poNo], ["Supplier", first.supplier || "-"],
      ["ETA", first.eta || "-"], ["Status", first.status || "Open"],
      ["Lead time (days)", String(first.leadDays || 0)], ["Lines", String(lines.length)]
    ];
    var rows = lines.map(function (p, i) {
      var amt = (Number(p.qty) || 0) * (Number(p.unitPrice) || 0);
      return "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + Engine.esc(p.materialCode) + "</td>" +
        "<td>" + Engine.esc(p.materialName || "") + "</td>" +
        "<td class='r'>" + Engine.fmtNum(p.qty) + "</td><td class='c'>" + Engine.esc(p.unit || "") + "</td>" +
        "<td class='r'>" + (p.unitPrice ? Engine.fmtNum(p.unitPrice, 2) : "-") + "</td>" +
        "<td class='r'>" + (amt ? Engine.fmtNum(amt, 2) : "-") + "</td></tr>";
    }).join("");
    var h = "<table class='lines'><tr><th style='width:5%'>No</th><th style='width:16%'>Material</th>" +
      "<th>Description</th><th style='width:12%'>Qty</th><th style='width:8%'>Unit</th>" +
      "<th style='width:14%'>Unit price</th><th style='width:15%'>Amount</th></tr>" + rows +
      "<tr><td colspan='6' class='r'><b>Total</b></td><td class='r'><b>" + Engine.fmtNum(total, 2) + "</b></td></tr></table>";
    UI.printHTML(UI.docShell("PURCHASE ORDER (FR-PP-14)", info, h,
      ["Dibuat oleh (Purchasing)", "Diperiksa oleh (Manager)", "Disetujui oleh (Direktur)"],
      first.note ? "Note: " + Engine.esc(first.note) : ""));
  }

  return { list: list, printPO: printPO };
})();
