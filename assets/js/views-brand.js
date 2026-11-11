/* ============================================================
   VIEWS - Master Brand (13-char SKU scheme, migration 020)
   ============================================================ */
window.ViewsBrand = (function () {
  function list(root) {
    var db = Store.get();
    var can = RBAC.canEditMaster("brands");
    var q = "";
    var head = UI.el("div", { class: "btn-row", style: "margin-bottom:10px" }, [
      UI.el("h2", { text: "Master Brand", style: "margin:0;flex:1" }),
      UI.input({ placeholder: "Search code / name / customer...", style: "width:240px" })
    ]);
    var search = head.lastChild;
    search.addEventListener("input", function () { q = search.value.toLowerCase(); draw(); });
    if (can) head.appendChild(UI.btn("+ New Brand", function () { editor(null); }, "btn-primary"));
    root.appendChild(head);
    var body = UI.el("div");
    root.appendChild(body);
    function draw() {
      UI.clear(body);
      var rows = db.brands.filter(function (b) {
        var c = Store.customerById(b.customerId);
        return !q || (b.id + " " + b.name + " " + (c ? c.name : "")).toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return a.id.localeCompare(b.id); });
      var cols = [
        { label: "Brand Code", cls: "mono", key: "id" },
        { label: "Brand Name", key: "name" },
        { label: "Customer", render: function (b) { var c = Store.customerById(b.customerId); return c ? c.name : "<span class='row-muted'>-</span>"; } },
        { label: "SKUs", render: function (b) { return db.fgs.filter(function (f) { return f.brandId === b.id; }).length; } }
      ];
      if (can) cols.push({ label: "", render: function (b) {
        return UI.el("div", { class: "btn-row" }, [
          UI.btn("Edit", function () { editor(b); }, "btn-sm"),
          UI.btn("Delete", function () {
            var used = db.fgs.some(function (f) { return f.brandId === b.id; });
            if (used) { UI.toast("Brand is used by SKUs - cannot delete", "err"); return; }
            UI.confirmDialog("Delete brand " + b.id + "?", function () { Store.deleteBrand(b.id); App.refresh(); });
          }, "btn-danger btn-sm")
        ]);
      } });
      body.appendChild(UI.table(cols, rows, { emptyText: "No brands yet. Add the 3-letter codes used by the SKU scheme." }));
    }
    draw();
  }
  function editor(rec) {
    var isNew = !rec;
    var d = Object.assign({ id: "", name: "", customerId: "" }, rec || {});
    var iCode = UI.input({ class: "input mono", value: d.id, placeholder: "e.g. BRL", maxlength: 3 });
    var iName = UI.input({ value: d.name, placeholder: "Brand name" });
    var iCust = UI.combo([["", "(no customer)"]].concat(Store.get().customers.map(function (c) { return [c.id, c.name + "  (" + c.id + ")"]; })), d.customerId, "Customer...");
    UI.modal({
      title: isNew ? "New Brand" : "Edit Brand - " + rec.id,
      body: UI.el("div", { class: "form-grid" }, [
        UI.field("Brand Code (3 letters)", iCode, "Uppercase A-Z, exactly 3 letters; keys the SKU code."),
        UI.field("Brand Name", iName),
        UI.field("Customer (brand owner)", iCust)
      ]),
      actions: [{ label: "Save Brand", cls: "btn-primary", onClick: function () {
        d.id = iCode.value.trim().toUpperCase();
        d.name = iName.value.trim();
        d.customerId = iCust.value || "";
        if (!/^[A-Z]{3}$/.test(d.id)) { UI.toast("Brand code must be exactly 3 letters A-Z", "err"); return; }
        if (!d.name) { UI.toast("Brand name is required", "err"); return; }
        if (isNew && Store.brandById(d.id)) { UI.toast("Brand code already exists", "err"); return; }
        if (!isNew && d.id !== rec.id && Store.brandById(d.id)) { UI.toast("Brand code already exists", "err"); return; }
        Store.saveBrand(d, isNew, rec ? rec.id : null);
        UI.closeModal(); App.refresh();
        UI.toast("Brand " + d.id + " saved", "ok");
      } }]
    });
  }
  return { list: list };
})();