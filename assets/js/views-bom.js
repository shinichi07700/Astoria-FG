/* ============================================================
   VIEWS - Bill of Material: list, builder, print document
   Complete material list: A. Formula (bulk) raw materials
   and B. Kemas (packaging) components in one document.
   ============================================================ */
window.ViewsBom = (function () {

  var editingId = null; /* null = list mode */

  /* ---------------- List ---------------- */
  function list(root) {
    if (editingId !== undefined && editingId !== null) { editor(root, editingId); return; }
    var db = Store.get();
    root.appendChild(UI.pageHead("Bill of Material",
      "One complete BOM per Finish Good: full formula (bulk) raw materials plus every kemas component, with item codes for Accurate. Replaces the old FR-PD sheet that only listed bulk + packaging.",
      [UI.btn("+ New BOM", function () { openEditor("__new__"); }, "btn-primary")]));

    var rows = db.boms.slice().sort(function (a, b) { return (b.noBom || "").localeCompare(a.noBom || ""); });
    root.appendChild(UI.card("BOM documents (" + rows.length + ")", null,
      UI.table([
        { label: "No BOM", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.noBom) + "</b>"; } },
        { label: "Finish Good", render: function (r) {
          var f = Store.fgById(r.fgId);
          return UI.el("div", {}, [
            UI.el("div", { class: "mono", style: "font-weight:700", text: f ? f.kodeFG : r.fgId }),
            UI.el("div", { style: "font-size:11.5px;color:var(--muted)", text: f ? f.deskripsi : "" })
          ]);
        } },
        { label: "Rev", cls: "num", key: "revision" },
        { label: "Customer", render: function (r) { return Engine.esc(r.customer || "-") + " / " + Engine.esc(r.noCustomer || "-"); } },
        { label: "Bulk Code", cls: "mono", key: "bulkCode" },
        { label: "Batch", render: function (r) { return Engine.esc(r.batchSize || "-") + " = " + Engine.fmtNum(r.batchYield) + " pcs"; } },
        { label: "Lines", cls: "num", render: function (r) { return String(r.items.length); } },
        { label: "Status", render: function (r) { return UI.el("span", { class: "pill " + (r.status === "Approved" ? "aktif" : "draft"), text: r.status }); } },
        { label: "", render: function (r) {
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Open", function () { openEditor(r.id); }, "btn-sm"),
            UI.btn("Print", function () { printBOM(r); }, "btn-sm"),
            UI.btn("Delete", function () {
              UI.confirmDialog("Delete BOM " + r.noBom + "?", function () { Store.deleteBOM(r.id); App.refresh(); });
            }, "btn-danger btn-sm")
          ]);
        } }
      ], rows, { emptyText: "No BOM yet. Create the first one." }), { tight: true }));
  }

  function openEditor(id) { editingId = id; App.refresh(); }
  function closeEditor() { editingId = null; App.refresh(); }

  /* ---------------- Builder ---------------- */
  function editor(root, id) {
    var db = Store.get();
    var isNew = id === "__new__";
    var d = isNew ? {
      id: null, noBom: "", fgId: "", revision: 0, mulaiBerlaku: Engine.todayISO(),
      customer: "", customerId: "", noCustomer: "", bulkCode: "", batchSize: "", batchYield: 1000,
      formulaId: "", packagingId: "", status: "Draft", items: []
    } : JSON.parse(JSON.stringify(db.boms.filter(function (b) { return b.id === id; })[0] || {}));
    if (!d.items) d.items = [];
    if (d.customerId == null) d.customerId = "";
    if (d.formulaId == null) d.formulaId = "";
    if (d.packagingId == null) d.packagingId = "";

    root.appendChild(UI.pageHead(isNew ? "New Bill of Material" : "BOM " + d.noBom + " (rev " + d.revision + ")",
      "Formula lines are entered per batch; kemas lines per piece. Per-unit and per-batch quantities are kept in sync automatically via the batch yield.",
      [UI.btn("< Back to list", closeEditor, "")]));

    /* ----- header form ----- */
    /* Finish Good picker lists Aktif SKUs only; when editing a BOM whose
       product is no longer Aktif we keep that one option (tagged with its
       status) so the existing link is never silently dropped. */
    function fgLabel(f) {
      return f.kodeFG + "  -  " + f.deskripsi + (f.status === "Aktif" ? "" : "  [" + f.status + "]");
    }
    var fgPool = db.fgs.filter(function (f) { return f.status === "Aktif"; });
    /* picker order: Deskripsi Produk A-Z (tie-break kode) */
    fgPool.sort(Store.fgDescCompare);
    if (!isNew && d.fgId) {
      var curFg = Store.fgById(d.fgId);
      if (curFg && curFg.status !== "Aktif") fgPool = [curFg].concat(fgPool);
    }
    var fgOpts = [["", "(select Finish Good)"]].concat(fgPool.map(function (f) { return [f.id, fgLabel(f)]; }));
    var iFg = UI.combo(fgOpts, d.fgId, "Type kode or description to search...");
    /* Customer: pick from the customer master once it has entries; fall back
       to free text so existing BOMs stay editable before any customer is
       registered. The combo value is the customer NAME (the boms.customer
       column) to stay compatible with the current schema, list and print. */
    var iCustomer;
    if (db.customers.length) {
      var seenCust = {}, custOpts = [["", "(select customer)"]];
      db.customers.forEach(function (c) {
        if (!c.name || seenCust[c.name]) return; seenCust[c.name] = 1;
        custOpts.push([c.name, c.name + (c.id ? "  (" + c.id + ")" : "")]);
      });
      if (d.customer && !seenCust[d.customer]) custOpts.push([d.customer, d.customer + "  (not in master)"]);
      iCustomer = UI.combo(custOpts, d.customer, "Type to search customer...");
    } else {
      iCustomer = UI.input({ value: d.customer });
    }
    var iNoCustomer = UI.input({ value: d.noCustomer });
    var iRev = UI.input({ type: "number", step: "1", min: "0", value: String(d.revision) });
    var iDate = UI.input({ type: "date", value: d.mulaiBerlaku || Engine.todayISO() });
    var iBulk = UI.input({ class: "input mono", value: d.bulkCode, placeholder: "Bulk / semi-finished item code" });
    var iBatchSize = UI.input({ value: d.batchSize, placeholder: "e.g. 100 L" });
    var iYield = UI.input({ type: "number", step: "1", min: "1", value: String(d.batchYield || 1000) });
    var iStatus = UI.select([["Draft", "Draft"], ["Approved", "Approved"]], d.status);
    /* Link the production BOM to its formula (FFS) and packaging (FPS) masters.
       The masters carry the shared parameters (BJ, pH, stability / fill volume,
       inkjet); recipe ratios and component ownership stay on the lines below.
       The stored id is kept as an option when the master row is absent so an
       existing link is never silently dropped. */
    function masterOpts(list, cur, noneLabel) {
      var opts = [["", noneLabel]].concat(list.map(function (m) { return [m.id, m.id]; }));
      if (cur && !list.some(function (m) { return m.id === cur; })) opts.push([cur, cur + "  (not in master)"]);
      return opts;
    }
    var iFormula = UI.combo(masterOpts(db.formulas, d.formulaId, "(no formula master)"), d.formulaId, "Link FFS formula master...");
    var iPackaging = UI.combo(masterOpts(db.packagings, d.packagingId, "(no packaging master)"), d.packagingId, "Link FPS packaging master...");
    var formulaRef = UI.el("div", { class: "hint", style: "font-size:11px;color:var(--muted);margin-top:2px" });
    var packagingRef = UI.el("div", { class: "hint", style: "font-size:11px;color:var(--muted);margin-top:2px" });
    function refreshMasterRefs() {
      var f = iFormula.value ? Store.formulaById(iFormula.value) : null;
      formulaRef.textContent = f
        ? "BJ " + Engine.fmtNum(f.bj) +
          (f.phMin !== "" && f.phMin != null ? "  \u00b7  pH " + f.phMin + (f.phMax != null && f.phMax !== "" && f.phMax !== f.phMin ? "-" + f.phMax : "") : "") +
          (f.viscosity ? "  \u00b7  " + f.viscosity : "") +
          "  \u00b7  stab " + [f.stabTk, f.stabTkul, f.stabT50, f.stabTm].join("/")
        : (iFormula.value ? "Not in master (dangling link)." : "");
      var p = iPackaging.value ? Store.packagingById(iPackaging.value) : null;
      packagingRef.textContent = p
        ? "Fill " + Engine.fmtNum(p.fillMin) + (p.fillMax && p.fillMax !== p.fillMin ? "-" + Engine.fmtNum(p.fillMax) : "") + " mL" +
          (p.shrinkTunnelC ? "  \u00b7  shrink " + Engine.fmtNum(p.shrinkTunnelC) + "\u00b0C" : "") +
          (p.inkjetSyntax ? "  \u00b7  inkjet " + p.inkjetSyntax : "")
        : (iPackaging.value ? "Not in master (dangling link)." : "");
    }
    var pvNo = UI.el("span", { class: "pv-kode", text: d.noBom || previewNo() });

    function previewNo() {
      return Engine.noBom((db.meta.seq.bom || 0) + 1, iNoCustomer.value.trim(), iDate.value);
    }
    function syncHeader() {
      d.fgId = iFg.value; d.customer = iCustomer.value.trim(); d.noCustomer = iNoCustomer.value.trim();
      d.revision = Number(iRev.value) || 0; d.mulaiBerlaku = iDate.value;
      d.bulkCode = iBulk.value.trim(); d.batchSize = iBatchSize.value.trim();
      d.batchYield = Number(iYield.value) || 1; d.status = iStatus.value;
      d.formulaId = iFormula.value || ""; d.packagingId = iPackaging.value || "";
      /* derive the customer FK (boms.customer_id) from the selected name/code */
      var cm = db.customers.filter(function (c) { return c.name === d.customer || c.id === d.customer; })[0];
      d.customerId = cm ? cm.id : "";
      refreshMasterRefs();
      if (isNew) pvNo.textContent = previewNo();
      renderLines("FORMULA"); renderLines("KEMAS");
    }
    [iFg, iCustomer, iNoCustomer, iRev, iDate, iBulk, iBatchSize, iYield, iStatus, iFormula, iPackaging].forEach(function (n) {
      n.addEventListener("input", syncHeader);
      n.addEventListener("change", syncHeader);
    });

    root.appendChild(UI.card("Document header", null, UI.el("div", {}, [
      UI.el("div", { class: "preview-box" }, [
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "No BOM (auto numbering)" }), pvNo]),
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "Status" }), UI.el("span", { class: "pill " + (d.status === "Approved" ? "aktif" : "draft"), text: d.status })])
      ]),
      UI.el("div", { class: "form-grid" }, [
        UI.field("Finish Good (Nama & No FG)", iFg),
        UI.field("Bulk / semi-finished code", iBulk, "Formula output code, e.g. TO01MR03TWB - used by finance in Accurate."),
        UI.field("Customer", iCustomer),
        UI.field("No Customer", iNoCustomer),
        UI.field("Revisi", iRev),
        UI.field("Mulai berlaku / Tgl BOM", iDate),
        UI.field("Batch size", iBatchSize),
        UI.field("Batch yield (pcs per batch)", iYield, "Formula qty per batch is divided by this to get qty per unit."),
        UI.field("Formula master (FFS)", UI.el("div", {}, [iFormula, formulaRef]), "Links BJ / pH / stability used by netting and QC."),
        UI.field("Packaging master (FPS)", UI.el("div", {}, [iPackaging, packagingRef]), "Links fill volume / shrink / inkjet for the pack line."),
        UI.field("Status", iStatus)
      ])
    ])));

    /* ----- line editors ----- */
    var wrapF = UI.el("div");
    var wrapK = UI.el("div");
    root.appendChild(wrapF);
    root.appendChild(wrapK);

    /* Formula lines live on a strict 100% weight-ratio basis: each line stores
       its pct and the section must total exactly 100.00% before it can save. */
    var formulaTotalEl = null;
    function formulaPctSum() {
      return d.items.reduce(function (s, it) { return it.section === "FORMULA" ? s + (Number(it.pct) || 0) : s; }, 0);
    }
    function updateFormulaTotal() {
      if (!formulaTotalEl) return;
      var sum = formulaPctSum();
      var ok = Math.abs(sum - 100) < 0.01;
      formulaTotalEl.textContent = "\u03a3 ratio = " + Engine.fmtNum(sum) + "%" +
        (sum === 0 ? "  (enter Ratio % per line, or use Auto % from qty)" : (ok ? "  \u2713 exactly 100%" : "  \u2014 must equal 100.00%"));
      formulaTotalEl.style.color = ok ? "#1a7f4b" : (sum === 0 ? "var(--muted)" : "#b42318");
      formulaTotalEl.style.fontWeight = "700";
    }
    function autoPctFromQty() {
      var f = d.items.filter(function (it) { return it.section === "FORMULA"; });
      var tot = f.reduce(function (s, it) { return s + (Number(it.qtyPerBatch) || 0); }, 0);
      if (!f.length) { UI.toast("Add formula lines first", "err"); return; }
      if (tot <= 0) { UI.toast("Set qty per batch on the formula lines first", "err"); return; }
      f.forEach(function (it) { it.pct = Engine.round4((Number(it.qtyPerBatch) || 0) / tot * 100); });
      renderLines("FORMULA");
      UI.toast("Ratio % filled from each line's share of qty per batch", "ok");
    }
    function formulaPctError() {
      var f = d.items.filter(function (it) { return it.section === "FORMULA"; });
      if (!f.length) return null;
      var sum = formulaPctSum();
      if (Math.abs(sum - 100) >= 0.01) {
        return "Formula ratios must total exactly 100% (now " + Engine.fmtNum(sum) + "%). Adjust the Ratio % column or use Auto % from qty.";
      }
      return null;
    }
    function customerOwnedNotice() {
      var cust = d.items.filter(function (it) { return it.section === "KEMAS" && it.supportedBy === "Customer"; }).length;
      if (cust) UI.toast(cust + " customer-supplied kemas component(s): never Astoria stock (SOH 0) - shortfalls become call-offs.", "ok");
    }

    function matsFor(section) {
      return db.materials.filter(function (m) {
        return section === "FORMULA" ? m.category === "RM" : (m.category === "PM" || m.category === "AX");
      });
    }

    function renderLines(section) {
      var wrap = section === "FORMULA" ? wrapF : wrapK;
      UI.clear(wrap);
      var isF = section === "FORMULA";
      var lines = d.items.filter(function (it) { return it.section === section; });
      var addBtn = UI.btn("+ Add " + (isF ? "formula material" : "kemas component"), function () {
        var pool = matsFor(section);
        d.items.push({
          section: section, materialCode: pool[0] ? pool[0].code : "",
          qtyPerUnit: isF ? 0 : 1,
          qtyPerBatch: isF ? 0 : (Number(iYield.value) || 1),
          unit: pool[0] ? pool[0].unit : "pcs", supportedBy: "Astoria",
          lossPct: 0, pct: 0, note: ""
        });
        renderLines(section);
      }, "btn-sm");
      var tbl = UI.el("table", { class: "editor" });
      var head = isF
        ? ["Material (formula / bulk)", "Ratio %", "Qty per batch", "Qty per unit (auto)", "Unit", "Loss %", "Supported by", "Note", ""]
        : ["Material (kemas component)", "Qty per unit", "Qty per batch (auto)", "Unit", "Loss %", "Supported by", "Note", ""];
      var ncol = head.length;
      tbl.appendChild(UI.el("thead", {}, [UI.el("tr", {}, head.map(function (h) { return UI.el("th", { text: h }); }))]));
      var tb = UI.el("tbody");
      lines.forEach(function (it) { tb.appendChild(lineRow(it, section)); });
      if (!lines.length) tb.appendChild(UI.el("tr", {}, [UI.el("td", { colspan: String(ncol), class: "empty", text: "No " + section.toLowerCase() + " line yet." })]));
      tbl.appendChild(tb);
      if (isF) {
        formulaTotalEl = UI.el("span", { class: "hint", style: "font-size:11.5px" });
        tbl.appendChild(UI.el("tfoot", {}, [UI.el("tr", {}, [UI.el("td", { colspan: String(ncol) }, [formulaTotalEl])])]));
        updateFormulaTotal();
      }
      var actions = [addBtn];
      if (isF) actions.push(UI.btn("Auto % from qty", autoPctFromQty, "btn-sm"));
      var hint = isF
        ? "raw materials consumed to produce the bulk - ratios must total 100%"
        : "packaging components per 1 pcs finish good. Supported by = supply ownership: Customer (bottles, jars, caps, pumps, godets, puffs, unit boxes, customer labels) or Astoria (master shippers, inner boxes, shrink film, tape, thermal labels).";
      wrap.appendChild(UI.card(
        isF ? "A. Formula (bulk) materials" : "B. Kemas (packaging) materials",
        actions, tbl, { tight: true, hint: hint }));
    }

    function lineRow(it, section) {
      var pool = matsFor(section);
      var opts = pool.map(function (m) { return [m.code, m.code + "  -  " + m.name]; });
      if (it.materialCode && !pool.some(function (m) { return m.code === it.materialCode; })) {
        opts.unshift([it.materialCode, it.materialCode + "  (unknown)"]);
      }
      var sel = UI.combo(opts, it.materialCode, "Type code or name...");
      var isF = section === "FORMULA";
      var iPct = isF ? UI.input({ type: "number", step: "0.0001", min: "0", value: String(it.pct || 0), style: "width:80px" }) : null;
      var iQty = UI.input({ type: "number", step: "0.00001", value: String(isF ? it.qtyPerBatch : it.qtyPerUnit) });
      var autoCell = UI.el("span", { class: "mono", style: "font-size:11.5px;color:var(--muted)" });
      var iUnit = UI.input({ value: it.unit, style: "width:64px" });
      var iLoss = UI.input({ type: "number", step: "0.1", min: "0", value: String(it.lossPct || 0), style: "width:70px" });
      var iSup = UI.select([["Astoria", "Astoria"], ["Customer", "Customer"]], it.supportedBy);
      var iNote = UI.input({ value: it.note || "", placeholder: "optional" });

      function sync() {
        it.materialCode = sel.value;
        var q = Number(iQty.value) || 0;
        var y = Number(iYield.value) || 1;
        if (isF) { it.qtyPerBatch = q; it.qtyPerUnit = Engine.round4(q / y); it.pct = Number(iPct.value) || 0; }
        else { it.qtyPerUnit = q; it.qtyPerBatch = Engine.round4(q * y); }
        it.unit = iUnit.value.trim(); it.lossPct = Number(iLoss.value) || 0;
        it.supportedBy = iSup.value; it.note = iNote.value.trim();
        autoCell.textContent = Engine.fmtNum(isF ? it.qtyPerUnit : it.qtyPerBatch);
        if (isF) updateFormulaTotal();
      }
      sel.addEventListener("change", function () {
        var m = Store.matMap()[sel.value];
        if (m) { iUnit.value = m.unit; }
        sync();
      });
      [iQty, iUnit, iLoss, iNote].forEach(function (n) { n.addEventListener("input", sync); });
      if (iPct) iPct.addEventListener("input", sync);
      iSup.addEventListener("change", sync);
      sync();

      var cells = [UI.el("td", {}, [sel])];
      if (isF) cells.push(UI.el("td", { class: "num-input" }, [iPct]));
      cells.push(UI.el("td", { class: "num-input" }, [iQty]));
      cells.push(UI.el("td", {}, [autoCell]));
      cells.push(UI.el("td", {}, [iUnit]));
      cells.push(UI.el("td", {}, [iLoss]));
      cells.push(UI.el("td", {}, [iSup]));
      cells.push(UI.el("td", {}, [iNote]));
      cells.push(UI.el("td", {}, [UI.el("button", {
        class: "del-btn", html: "&times;", title: "Remove line",
        onclick: function () {
          d.items = d.items.filter(function (x) { return x !== it; });
          renderLines(section);
        }
      })]));
      return UI.el("tr", {}, cells);
    }

    renderLines("FORMULA");
    renderLines("KEMAS");

    /* ----- footer actions ----- */
    root.appendChild(UI.el("div", { class: "btn-row", style: "margin-top:4px" }, [
      UI.btn("Save BOM", function () {
        if (!d.fgId) { UI.toast("Select a Finish Good first", "err"); return; }
        if (!d.items.length) { UI.toast("Add at least one material line", "err"); return; }
        if (d.items.some(function (it) { return !it.materialCode; })) { UI.toast("Every line needs a material", "err"); return; }
        syncHeader();
        var perr = formulaPctError();
        if (perr) { UI.toast(perr, "err"); return; }
        if (isNew) {
          d.id = Store.uid("BOM");
          d.noBom = Engine.noBom(Store.nextSeq("bom"), d.noCustomer, d.mulaiBerlaku);
          Store.saveBOM(d, true);
        } else {
          Store.saveBOM(d, false);
        }
        UI.toast("BOM saved: " + d.noBom, "ok");
        customerOwnedNotice();
        closeEditor();
      }, "btn-primary"),
      UI.btn("Save & Print", function () {
        if (!d.fgId || !d.items.length) { UI.toast("Complete header and lines before printing", "err"); return; }
        syncHeader();
        var perr2 = formulaPctError();
        if (perr2) { UI.toast(perr2, "err"); return; }
        if (isNew) {
          d.id = Store.uid("BOM");
          d.noBom = Engine.noBom(Store.nextSeq("bom"), d.noCustomer, d.mulaiBerlaku);
          Store.saveBOM(d, true);
          isNew = false;
        } else {
          Store.saveBOM(d, false);
        }
        printBOM(d);
        closeEditor();
      }, ""),
      UI.btn("Cancel", closeEditor, "btn-ghost")
    ]));
  }

  /* ---------------- Print: complete BOM Request ---------------- */
  function bomTableHTML(b) {
    var h = "<table class='lines'><tr>" +
      "<th style='width:4%'>No</th><th>Description</th><th style='width:11%'>Item Code</th>" +
      "<th style='width:9%'>Qty / Unit</th><th style='width:6%'>Unit</th><th style='width:10%'>Qty / Batch</th>" +
      "<th style='width:9%'>Loss %</th><th style='width:10%'>Supported by</th></tr>";
    var n = 0;
    function row(it) {
      var m = Store.matMap()[it.materialCode] || {};
      n++;
      return "<tr><td class='c'>" + n + "</td><td>" + Engine.esc(m.name || it.materialCode) +
        (it.note ? " <i>(" + Engine.esc(it.note) + ")</i>" : "") + "</td>" +
        "<td class='c'>" + Engine.esc(it.materialCode) + "</td>" +
        "<td class='r'>" + Engine.fmtNum(it.qtyPerUnit) + "</td><td class='c'>" + Engine.esc(it.unit) + "</td>" +
        "<td class='r'>" + Engine.fmtNum(it.qtyPerBatch) + "</td>" +
        "<td class='c'>" + (it.lossPct ? Engine.fmtNum(it.lossPct) : "-") + "</td>" +
        "<td class='c'>" + Engine.esc(it.supportedBy) + "</td></tr>";
    }
    var f = b.items.filter(function (i) { return i.section === "FORMULA"; });
    var k = b.items.filter(function (i) { return i.section === "KEMAS"; });
    if (f.length) {
      h += "<tr class='sec-row'><td colspan='8'>A. BULK / FORMULA MATERIALS - per batch " +
        Engine.esc(b.batchSize || "-") + " = " + Engine.fmtNum(b.batchYield) + " pcs (bulk code " + Engine.esc(b.bulkCode || "-") + ")</td></tr>";
      f.forEach(function (it) { h += row(it); });
    }
    if (k.length) {
      h += "<tr class='sec-row'><td colspan='8'>B. KEMAS / PACKAGING MATERIALS - per 1 pcs finish good</td></tr>";
      k.forEach(function (it) { h += row(it); });
    }
    return h + "</table>";
  }

  function printBOM(b) {
    var fg = Store.fgById(b.fgId);
    var info = [
      ["No BOM", b.noBom], ["Tgl", b.mulaiBerlaku],
      ["Customer", b.customer || "-"], ["No Customer", b.noCustomer || "-"],
      ["Nama FG", fg ? fg.deskripsi : "-"], ["No FG", fg ? fg.kodeFG : "-"],
      ["Revisi", String(b.revision)], ["Status", b.status]
    ];
    var note = "Complete material list: section A covers all raw materials consumed to produce the bulk (formula), " +
      "section B covers all packaging (kemas) components including auxiliary. Qty/Unit already includes stated loss. " +
      "Item codes are the codes used by finance in the Accurate system.";
    UI.printHTML(UI.docShell("BILL OF MATERIAL REQUEST", info, bomTableHTML(b),
      ["Dibuat oleh (RND)", "Diperiksa oleh (PPIC)", "Disetujui oleh (QA)"], note));
  }

  return {
    list: list, printBOM: printBOM, bomTableHTML: bomTableHTML,
    resetEditor: function () { editingId = null; }
  };
})();
