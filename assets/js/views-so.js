/* ============================================================
   VIEWS - Sales Order (FR-MK-03)
   Marketing raises a demand signal: customer + an Aktif Finish
   Good + netto per unit + order qty + delivery date. The status
   machine (Draft -> Confirmed -> Closed) lives in rbac.js; the
   commercial fields lock once Confirmed. Confirmed orders feed
   the PPIC netting page.
   ============================================================ */
window.ViewsSO = (function () {

  var soFilter = { q: "", status: "" };

  function soPill(status) {
    var cls = status === "Confirmed" ? "info" : (status === "Closed" ? "aktif" : "pending");
    return UI.el("span", { class: "pill " + cls, text: status || "Draft" });
  }
  function custName(id) {
    var c = id ? Store.customerById(id) : null;
    return c ? (c.name || c.id) : "-";
  }
  function fgLabel(id) {
    var f = id ? Store.fgById(id) : null;
    return f ? (f.kodeFG + " - " + (f.deskripsi || "")) : (id || "-");
  }

  /* Customer picker (m_customer). Value = customer id. */
  function customerCombo(value) {
    var db = Store.get();
    var opts = [["", "(no customer)"]].concat(db.customers.map(function (c) {
      return [c.id, (c.name || c.id) + (c.id ? "  (" + c.id + ")" : "")];
    }));
    if (value && !db.customers.some(function (c) { return c.id === value; })) {
      opts.push([value, value + "  (not in master)"]);
    }
    return UI.combo(opts, value || "", "Type to search customer...");
  }
  /* Finish Good picker restricted to Aktif SKUs (plan: fg FK restricted
     to Aktif). A non-Aktif value already on the row is still shown so an
     old order stays readable, flagged as such. */
  function fgCombo(value) {
    var db = Store.get();
    var aktif = db.fgs.filter(function (f) { return f.status === "Aktif"; }).sort(Store.fgDescCompare);
    var opts = [["", "(select an Aktif Finish Good)"]].concat(aktif.map(function (f) {
      return [f.id, f.kodeFG + "  -  " + (f.deskripsi || "")];
    }));
    if (value && !aktif.some(function (f) { return f.id === value; })) {
      opts.push([value, fgLabel(value) + "  (not Aktif)"]);
    }
    return UI.combo(opts, value || "", "Type to search Finish Good...");
  }

  /* ---------------- list ---------------- */
  function list(root) {
    var db = Store.get();
    var canEdit = RBAC.canEditSO();
    root.appendChild(UI.pageHead("Sales Order",
      "Marketing raises the customer order (FR-MK-03): an Aktif Finish Good, net weight per unit, order quantity and delivery date. Confirming locks the commercial fields; a Confirmed order drives PPIC netting.",
      canEdit ? [UI.btn("+ New Sales Order", function () { soEditor(null); }, "btn-primary")] : []));

    var search = UI.input({ placeholder: "Search no SO / customer / F/G...", value: soFilter.q });
    search.addEventListener("input", function () { soFilter.q = search.value; draw(); });
    var fStatus = UI.select([["", "All statuses"], ["Draft", "Draft"], ["Confirmed", "Confirmed"], ["Closed", "Closed"]], soFilter.status);
    fStatus.addEventListener("change", function () { soFilter.status = fStatus.value; draw(); });

    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = soFilter.q.toLowerCase();
      var rows = db.salesOrders.filter(function (s) {
        if (soFilter.status && s.status !== soFilter.status) return false;
        if (!q) return true;
        return ((s.noSo || "") + " " + custName(s.customerId) + " " + fgLabel(s.fgId) + " " + (s.kodeBarang || "")).toLowerCase().indexOf(q) >= 0;
      });
      var cols = [
        { label: "No SO", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.noSo) + "</b>"; } },
        { label: "Customer", render: function (r) { return Engine.esc(custName(r.customerId)); } },
        { label: "Finish Good", render: function (r) {
          var f = Store.fgById(r.fgId);
          return UI.el("div", {}, [
            UI.el("div", { class: "mono", text: f ? f.kodeFG : (r.fgId || "-") }),
            UI.el("div", { style: "font-size:11.5px;color:var(--muted)", text: f ? (f.deskripsi || "") : "" })
          ]);
        } },
        { label: "Kode Barang", cls: "mono", render: function (r) { return Engine.esc(r.kodeBarang || "-"); } },
        { label: "Netto/Unit", cls: "num", render: function (r) { return Engine.fmtNum(r.nettoPerUnit) + " kg"; } },
        { label: "Order Qty", cls: "num", render: function (r) { return "<b>" + Engine.fmtNum(r.orderQty, 0) + "</b>"; } },
        { label: "Delivery", cls: "mono", render: function (r) { return Engine.esc(r.deliveryDate || "-"); } },
        { label: "Status", render: function (r) { return soPill(r.status); } },
        { label: "", render: function (r) { return rowActions(r, canEdit); } }
      ];
      bodyWrap.appendChild(UI.table(cols, rows, { emptyText: "No sales order yet." + (canEdit ? " Create the first one." : "") }));
    }

    function rowActions(r, canEdit) {
      var btns = [UI.btn("View", function () { viewSO(r); }, "btn-sm")];
      if (canEdit && r.status === "Draft") {
        btns.push(UI.btn("Edit", function () { soEditor(r); }, "btn-sm"));
      }
      RBAC.transitionsFrom("salesOrder", r.status).forEach(function (t) {
        btns.push(UI.btn(t.to === "Confirmed" ? "Confirm" : (t.to === "Closed" ? "Close" : t.to),
          function () { doTransition(r, t.to); }, "btn-sm btn-primary"));
      });
      if (canEdit && r.status === "Draft") {
        btns.push(UI.btn("Delete", function () {
          UI.confirmDialog("Delete sales order " + r.noSo + "? This cannot be undone.", function () {
            Store.deleteSalesOrder(r.id); App.refresh(); UI.toast("Sales order deleted", "ok");
          });
        }, "btn-danger btn-sm"));
      }
      return UI.el("div", { class: "btn-row" }, btns);
    }

    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, fStatus, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.salesOrders.length + " orders" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
    if (!canEdit) root.appendChild(UI.el("div", { class: "hint", style: "margin-top:6px",
      text: "Read-only for " + ((db.meta.user || {}).role || "your role") + " - sales orders are raised by Marketing." }));
  }

  function doTransition(r, to) {
    var label = to === "Confirmed"
      ? "Confirm " + r.noSo + "? The commercial fields lock and PPIC can start netting."
      : "Close " + r.noSo + "? This marks the demand fulfilled.";
    UI.confirmDialog(label, function () {
      if (Store.transitionSO(r.id, to)) { App.refresh(); UI.toast("Sales order " + to.toLowerCase(), "ok"); }
      else UI.toast("Transition not allowed for your role", "err");
    }, to === "Confirmed" ? "Confirm order" : "Close order");
  }

  /* ---------------- editor (create / edit Draft) ---------------- */
  function soEditor(rec) {
    if (!RBAC.canEditSO()) { UI.toast("Sales orders are read-only for your role", "err"); return; }
    var isNew = !rec;
    var d = Object.assign({
      id: "", noSo: "", customerId: "", fgId: "", kodeBarang: "",
      nettoPerUnit: 0, orderQty: 0, deliveryDate: "", status: "Draft", note: "", createdBy: ""
    }, rec || {});
    /* Commercial fields freeze once the order leaves Draft (rbac lockAfter). */
    var locked = RBAC.lockedGroups("salesOrder", d.status).indexOf("commercial") >= 0;

    var iCust = customerCombo(d.customerId);
    var iFg = fgCombo(d.fgId);
    var iKode = UI.input({ value: d.kodeBarang, placeholder: "Customer article code" });
    var iNetto = UI.input({ type: "number", step: "0.0001", min: "0", value: String(d.nettoPerUnit || "") });
    var iQty = UI.input({ type: "number", step: "1", min: "1", value: String(d.orderQty || "") });
    var iDeliv = UI.input({ type: "date", value: d.deliveryDate || "" });
    var iNote = UI.el("textarea", { class: "input", rows: "2", style: "width:100%", placeholder: "Order notes / special instructions" });
    iNote.value = d.note || "";

    var commercial = [iCust, iFg, iKode, iNetto, iQty, iDeliv];
    if (locked) commercial.forEach(function (n) { n.disabled = true; });

    var body = UI.el("div", {}, [
      locked ? UI.el("div", { class: "hint", style: "margin-bottom:10px;color:var(--muted)",
        text: "This order is " + d.status + " - commercial fields are locked." }) : null,
      UI.el("div", { class: "form-grid" }, [
        UI.field("Customer", iCust, "Brand owner / customer (Master Customer)."),
        UI.field("Finish Good (Aktif only)", iFg, "Only Aktif SKUs may be ordered."),
        UI.field("Kode Barang", iKode, "Customer's own article code."),
        UI.field("Netto per unit (kg)", iNetto, "Net fill weight per piece, used for bulk netting."),
        UI.field("Order Qty (pcs)", iQty),
        UI.field("Delivery date", iDeliv)
      ]),
      UI.field("Note", iNote)
    ]);

    UI.modal({
      title: isNew ? "New Sales Order" : "Sales Order - " + (rec.noSo || rec.id),
      wide: true,
      body: body,
      actions: locked ? [] : [{
        label: "Save Sales Order", cls: "btn-primary", onClick: function () {
          var fgId = iFg.value, fg = Store.fgById(fgId);
          var qty = Number(iQty.value) || 0;
          var netto = Number(iNetto.value) || 0;
          var deliv = iDeliv.value;
          if (!fgId || !fg) { UI.toast("Select a Finish Good", "err"); return; }
          if (fg.status !== "Aktif") { UI.toast("Finish Good " + fg.kodeFG + " is " + (fg.status || "not Aktif") + " - only Aktif SKUs may be ordered", "err"); return; }
          if (qty <= 0) { UI.toast("Order quantity must be positive", "err"); return; }
          if (netto <= 0) { UI.toast("Netto per unit must be greater than zero", "err"); return; }
          if (!deliv) { UI.toast("Delivery date is required", "err"); return; }

          d.customerId = iCust.value; d.fgId = fgId; d.kodeBarang = iKode.value.trim();
          d.nettoPerUnit = netto; d.orderQty = qty; d.deliveryDate = deliv; d.note = iNote.value.trim();
          if (isNew) {
            d.id = Store.uid("SO");
            d.noSo = Engine.noRequest("SO", Store.nextSeq("so"), Engine.todayISO());
            d.status = "Draft";
            d.createdBy = (Store.get().meta.user || {}).email || (Store.get().meta.user || {}).name || "";
          }
          Store.saveSalesOrder(d, isNew, rec ? rec.id : null);
          UI.closeModal(); App.refresh();
          UI.toast("Sales order " + d.noSo + " saved", "ok");
        }
      }]
    });
  }

  /* ---------------- read-only view + linked PPIC output ---------------- */
  function viewSO(rec) {
    var db = Store.get();
    var prs = db.purchaseReqs.filter(function (r) { return r.soId === rec.id; });
    var cos = db.calloffs.filter(function (r) { return r.soId === rec.id; });
    var wos = db.workOrdersBulk.filter(function (r) { return r.soId === rec.id; });

    var linked = UI.el("div", { style: "margin-top:12px" });
    function docBlock(title, rows, cols) {
      linked.appendChild(UI.el("div", { style: "margin-bottom:10px" }, [
        UI.el("div", { style: "font-weight:700;font-size:12.5px;margin-bottom:4px", text: title + " (" + rows.length + ")" }),
        rows.length ? UI.table(cols, rows, { emptyText: "" }, { tight: true })
          : UI.el("div", { class: "hint", style: "color:var(--muted);font-size:12px", text: "None yet - run PPIC netting for this order." })
      ]));
    }
    docBlock("Purchase requisition lines", prs, [
      { label: "Req No", cls: "mono", key: "reqNo" },
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "materialName" },
      { label: "Qty", cls: "num", render: function (r) { return Engine.fmtNum(r.qty) + " " + Engine.esc(r.unit); } },
      { label: "Required by", cls: "mono", key: "requiredBy" },
      { label: "Status", render: function (r) { return UI.tag(r.status); } }
    ]);
    docBlock("Call-off lines (customer-supplied)", cos, [
      { label: "Call-off No", cls: "mono", key: "callOffNo" },
      { label: "Material", cls: "mono", key: "materialCode" },
      { label: "Name", key: "materialName" },
      { label: "Qty", cls: "num", render: function (r) { return Engine.fmtNum(r.qty) + " " + Engine.esc(r.unit); } },
      { label: "Required by", cls: "mono", key: "requiredBy" },
      { label: "Status", render: function (r) { return UI.tag(r.status); } }
    ]);
    docBlock("Bulk campaign batches", wos, [
      { label: "Campaign", cls: "mono", key: "campaignNo" },
      { label: "WO No", cls: "mono", key: "woNo" },
      { label: "Batch", cls: "num", key: "batchSeq" },
      { label: "Mixer", render: function (r) { var m = Store.mixerById(r.mixerId); return UI.el("span", { class: "mono", text: m ? m.name : (r.mixerId || "-") }); } },
      { label: "Planned kg", cls: "num", render: function (r) { return Engine.fmtNum(r.plannedKg); } },
      { label: "Status", render: function (r) { return UI.tag(r.status); } }
    ]);

    UI.modal({
      title: "Sales Order " + rec.noSo,
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "Status" }), UI.el("dd", {}, [soPill(rec.status)]),
          UI.el("dt", { text: "Customer" }), UI.el("dd", { text: custName(rec.customerId) }),
          UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: fgLabel(rec.fgId) }),
          UI.el("dt", { text: "Kode Barang" }), UI.el("dd", { class: "mono", text: rec.kodeBarang || "-" }),
          UI.el("dt", { text: "Netto per unit" }), UI.el("dd", { text: Engine.fmtNum(rec.nettoPerUnit) + " kg" }),
          UI.el("dt", { text: "Order qty" }), UI.el("dd", { text: Engine.fmtNum(rec.orderQty, 0) + " pcs" }),
          UI.el("dt", { text: "Delivery date" }), UI.el("dd", { class: "mono", text: rec.deliveryDate || "-" }),
          UI.el("dt", { text: "Created by" }), UI.el("dd", { text: rec.createdBy || "-" }),
          UI.el("dt", { text: "Note" }), UI.el("dd", { text: rec.note || "-" })
        ]),
        linked
      ]),
      actions: [{ label: "Print (FR-MK-03)", cls: "btn-primary", onClick: function () { printSO(rec); } }]
    });
  }

  /* ---------------- print view (FR-MK-03) ---------------- */
  function printSO(rec) {
    var info = [
      ["No SO", rec.noSo], ["Status", rec.status || "Draft"],
      ["Customer", custName(rec.customerId)], ["Delivery date", rec.deliveryDate || "-"],
      ["Kode Barang", rec.kodeBarang || "-"], ["Created by", rec.createdBy || "-"]
    ];
    var f = Store.fgById(rec.fgId);
    var h = "<table class='lines'><tr><th style='width:6%'>No</th><th style='width:20%'>Kode F/G</th>" +
      "<th>Deskripsi</th><th style='width:14%'>Netto/Unit (kg)</th><th style='width:14%'>Order Qty (pcs)</th></tr>" +
      "<tr><td class='c'>1</td><td class='c'>" + Engine.esc(f ? f.kodeFG : (rec.fgId || "-")) + "</td>" +
      "<td>" + Engine.esc(f ? (f.deskripsi || "") : "") + "</td>" +
      "<td class='r'>" + Engine.fmtNum(rec.nettoPerUnit) + "</td>" +
      "<td class='r'><b>" + Engine.fmtNum(rec.orderQty, 0) + "</b></td></tr></table>";
    UI.printHTML(UI.docShell("SALES ORDER (FR-MK-03)", info, h,
      ["Dibuat oleh (Marketing)", "Diperiksa oleh (PPIC)", "Disetujui oleh (Manager)"],
      rec.note ? "Note: " + Engine.esc(rec.note) : ""));
  }

  return { list: list, printSO: printSO };
})();
