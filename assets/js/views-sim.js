/* ============================================================
   VIEWS - Order Simulation (MR/PR), Request documents,
   Audit Log, Settings & Data management
   ============================================================ */
window.ViewsSim = (function () {

  var lastResult = null; /* {fg, bom, orderQty, date, explosion} */

  /* ---------------- Order simulation ---------------- */
  function sim(root) {
    var db = Store.get();
    var withBom = db.fgs.filter(function (f) { return Store.bomByFg(f.id); });

    root.appendChild(UI.pageHead("Order Simulation",
      "Pick a Finish Good and an incoming order quantity: the approved BOM is exploded line by line, netted against warehouse stock, and split into a Material Request (issue from stock) and a Purchase Request (shortage / non-stock buy).",
      []));

    var iFg = UI.select(
      [["", "(select Finish Good with BOM)"]].concat(withBom.map(function (f) { return [f.id, f.kodeFG + "  -  " + f.deskripsi]; })),
      lastResult ? lastResult.fg.id : (withBom[0] ? withBom[0].id : ""));
    var iQty = UI.input({ type: "number", step: "1", min: "1", value: String(lastResult ? lastResult.orderQty : 1000) });
    var iDate = UI.input({ type: "date", value: Engine.todayISO() });
    var resultWrap = UI.el("div");

    root.appendChild(UI.card("Simulation input", [
      UI.btn("Run simulation", function () {
        var fg = Store.fgById(iFg.value);
        if (!fg) { UI.toast("Select a Finish Good", "err"); return; }
        var qty = Number(iQty.value) || 0;
        if (qty <= 0) { UI.toast("Order quantity must be positive", "err"); return; }
        var bom = Store.bomByFg(fg.id);
        if (!bom) { UI.toast("No BOM for this F/G", "err"); return; }
        if (fg.status !== "Aktif") UI.toast("Warning: F/G status is " + fg.status, "err");
        lastResult = {
          fg: fg, bom: bom, orderQty: qty, date: iDate.value,
          explosion: Engine.explode(bom, qty, Store.matMap())
        };
        renderResult(resultWrap);
      }, "btn-primary")
    ], UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Finish Good", iFg, "Only F/G with a BOM can be simulated."),
        UI.field("Incoming order quantity (pcs)", iQty),
        UI.field("Simulation date", iDate)
      ])
    ])));

    root.appendChild(resultWrap);
    if (lastResult) renderResult(resultWrap);

    /* history */
    root.appendChild(UI.card("Simulation history", null,
      UI.table([
        { label: "No Sim", cls: "mono", key: "noSim" },
        { label: "Date", cls: "mono", key: "date" },
        { label: "Finish Good", cls: "mono", key: "fgKode" },
        { label: "Order Qty", cls: "num", key: "orderQty" },
        { label: "BOM", cls: "mono", key: "noBom" },
        { label: "Material Request", cls: "mono", render: function (r) { return r.mrDocNo || "<span class='row-muted'>-</span>"; } },
        { label: "Purchase Request", cls: "mono", render: function (r) { return r.prDocNo || "<span class='row-muted'>-</span>"; } },
        { label: "", render: function (r) {
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Print plan", function () { printSim(r); }, "btn-sm")
          ]);
        } }
      ], db.sims, { emptyText: "No simulation saved yet." }), { tight: true }));
  }

  function renderResult(wrap) {
    UI.clear(wrap);
    var r = lastResult;
    var e = r.explosion;
    wrap.appendChild(UI.card("Requirement plan - " + r.fg.kodeFG + " x " + Engine.fmtNum(r.orderQty, 0) + " pcs",
      [
        UI.btn("Generate MR & PR", function () { generateDocs(r); }, "btn-primary"),
        UI.btn("Print plan", function () { printSim(simRecordFrom(r)); }, "")
      ],
      UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "BOM used" }), UI.el("dd", { class: "mono", text: r.bom.noBom + " rev " + r.bom.revision + " [" + r.bom.status + "]" }),
          UI.el("dt", { text: "Batch reference" }), UI.el("dd", { text: (r.bom.batchSize || "-") + " = " + Engine.fmtNum(r.bom.batchYield) + " pcs, bulk code " + (r.bom.bulkCode || "-") }),
          UI.el("dt", { text: "Lines to issue (MR)" }), UI.el("dd", { text: e.mrLines.length + (e.mrLines.length === 1 ? " line" : " lines") }),
          UI.el("dt", { text: "Lines to purchase (PR)" }), UI.el("dd", { text: e.prLines.length + (e.prLines.length === 1 ? " line" : " lines") })
        ]),
        UI.table([
          { label: "Sec", render: function (l) { return UI.tag(l.section === "FORMULA" ? "A" : "B"); } },
          { label: "Item Code", cls: "mono", key: "materialCode" },
          { label: "Description", key: "name" },
          { label: "Qty/Unit", cls: "num", render: function (l) { return Engine.fmtNum(l.perUnit); } },
          { label: "Loss %", cls: "num", render: function (l) { return l.lossPct ? Engine.fmtNum(l.lossPct) : "-"; } },
          { label: "Gross Req", cls: "num", render: function (l) { return "<b>" + Engine.fmtNum(l.gross) + "</b> " + Engine.esc(l.unit); } },
          { label: "On Hand", cls: "num", render: function (l) { return Engine.fmtNum(l.onHand); } },
          { label: "MR (issue)", cls: "num", render: function (l) { return l.mrQty > 0 ? "<span style='color:var(--green);font-weight:700'>" + Engine.fmtNum(l.mrQty) + "</span>" : "-"; } },
          { label: "PR (buy)", cls: "num", render: function (l) { return l.prQty > 0 ? "<span style='color:var(--red);font-weight:700'>" + Engine.fmtNum(l.prQty) + "</span>" : "-"; } },
          { label: "Supported", render: function (l) { return UI.tag(l.supportedBy || "-"); } }
        ], e.lines, { emptyText: "BOM has no lines." })
      ]), { tight: true, hint: "gross requirement = qty/unit x order qty x (1 + loss%)" }));
  }

  function simRecordFrom(r) {
    return {
      noSim: "(not saved)", date: r.date, fgId: r.fg.id, fgKode: r.fg.kodeFG,
      fgName: r.fg.deskripsi, bomId: r.bom.id, noBom: r.bom.noBom,
      orderQty: r.orderQty, lines: r.explosion.lines, mrDocNo: "", prDocNo: ""
    };
  }

  function generateDocs(r) {
    var db = Store.get();
    var e = r.explosion;
    var mrDoc = null, prDoc = null;
    if (e.mrLines.length) {
      mrDoc = {
        id: Store.uid("MR"), type: "MR",
        noDoc: Engine.noRequest("MR", Store.nextSeq("mr"), r.date), date: r.date,
        fgId: r.fg.id, fgKode: r.fg.kodeFG, fgName: r.fg.deskripsi,
        noBom: r.bom.noBom, orderQty: r.orderQty,
        lines: e.mrLines.map(function (l) {
          return { code: l.materialCode, name: l.name, unit: l.unit, qty: l.mrQty, onHand: l.onHand, remark: "Issue from warehouse (" + (l.supportedBy || "-") + ")" };
        })
      };
      Store.saveRequest(mrDoc);
    }
    if (e.prLines.length) {
      prDoc = {
        id: Store.uid("PR"), type: "PR",
        noDoc: Engine.noRequest("PR", Store.nextSeq("pr"), r.date), date: r.date,
        fgId: r.fg.id, fgKode: r.fg.kodeFG, fgName: r.fg.deskripsi,
        noBom: r.bom.noBom, orderQty: r.orderQty,
        lines: e.prLines.map(function (l) {
          return { code: l.materialCode, name: l.name, unit: l.unit, qty: l.prQty, onHand: l.onHand, remark: l.stocked ? "Shortage vs stock" : "Non-stock / direct buy" };
        })
      };
      Store.saveRequest(prDoc);
    }
    var rec = {
      id: Store.uid("SIM"),
      noSim: "SIM-" + Engine.pad(Store.nextSeq("sim"), 4),
      date: r.date, fgId: r.fg.id, fgKode: r.fg.kodeFG, fgName: r.fg.deskripsi,
      bomId: r.bom.id, noBom: r.bom.noBom, orderQty: r.orderQty,
      lines: e.lines, mrDocNo: mrDoc ? mrDoc.noDoc : "", prDocNo: prDoc ? prDoc.noDoc : ""
    };
    Store.saveSim(rec);
    UI.toast("Saved " + rec.noSim + (mrDoc ? " + " + mrDoc.noDoc : "") + (prDoc ? " + " + prDoc.noDoc : ""), "ok");
    App.go("requests");
  }

  /* ---------------- MR / PR documents ---------------- */
  function requests(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("Material & Purchase Requests",
      "Documents generated by the order simulation. Material Request = items issued from warehouse stock; Purchase Request = shortage or non-stock items to buy.",
      []));
    root.appendChild(UI.card("Generated documents (" + db.requests.length + ")", null,
      UI.table([
        { label: "No Dokumen", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.noDoc) + "</b>"; } },
        { label: "Type", render: function (r) { return UI.el("span", { class: "pill " + (r.type === "MR" ? "info" : "pending"), text: r.type === "MR" ? "Material Request" : "Purchase Request" }); } },
        { label: "Date", cls: "mono", key: "date" },
        { label: "Finish Good", render: function (r) {
          return UI.el("div", {}, [
            UI.el("div", { class: "mono", text: r.fgKode }),
            UI.el("div", { style: "font-size:11.5px;color:var(--muted)", text: r.fgName || "" })
          ]);
        } },
        { label: "Order Qty", cls: "num", key: "orderQty" },
        { label: "Lines", cls: "num", render: function (r) { return String(r.lines.length); } },
        { label: "", render: function (r) {
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("View", function () { viewRequest(r); }, "btn-sm"),
            UI.btn("Print", function () { printRequest(r); }, "btn-sm")
          ]);
        } }
      ], db.requests, { emptyText: "No request generated yet - run an order simulation first." }), { tight: true }));
  }

  function viewRequest(r) {
    UI.modal({
      title: r.noDoc + " - " + (r.type === "MR" ? "Material Request" : "Purchase Request"),
      wide: true,
      body: UI.el("div", {}, [
        UI.el("div", { class: "kv", style: "margin-bottom:12px" }, [
          UI.el("dt", { text: "Finish Good" }), UI.el("dd", { class: "mono", text: r.fgKode + " - " + (r.fgName || "") }),
          UI.el("dt", { text: "No BOM / order qty" }), UI.el("dd", { class: "mono", text: (r.noBom || "-") + " / " + Engine.fmtNum(r.orderQty, 0) + " pcs" }),
          UI.el("dt", { text: "Date" }), UI.el("dd", { class: "mono", text: r.date })
        ]),
        UI.table([
          { label: "Item Code", cls: "mono", key: "code" },
          { label: "Description", key: "name" },
          { label: "Unit", key: "unit" },
          { label: "On Hand", cls: "num", render: function (l) { return Engine.fmtNum(l.onHand); } },
          { label: "Qty Requested", cls: "num", render: function (l) { return "<b>" + Engine.fmtNum(l.qty) + "</b>"; } },
          { label: "Remark", key: "remark" }
        ], r.lines)
      ]),
      actions: [{ label: "Print", cls: "btn-primary", onClick: function () { printRequest(r); } }]
    });
  }

  function requestTableHTML(r) {
    var h = "<table class='lines'><tr><th style='width:4%'>No</th><th style='width:12%'>Item Code</th><th>Description</th>" +
      "<th style='width:7%'>Unit</th><th style='width:10%'>On Hand</th><th style='width:12%'>Qty Requested</th><th style='width:20%'>Remark</th></tr>";
    r.lines.forEach(function (l, i) {
      h += "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + Engine.esc(l.code) + "</td><td>" + Engine.esc(l.name) +
        "</td><td class='c'>" + Engine.esc(l.unit) + "</td><td class='r'>" + Engine.fmtNum(l.onHand) +
        "</td><td class='r'><b>" + Engine.fmtNum(l.qty) + "</b></td><td>" + Engine.esc(l.remark || "") + "</td></tr>";
    });
    return h + "</table>";
  }

  function printRequest(r) {
    var info = [
      ["No " + r.type, r.noDoc], ["Tgl", r.date],
      ["No FG", r.fgKode], ["Nama FG", r.fgName || "-"],
      ["No BOM", r.noBom || "-"], ["Order Qty", Engine.fmtNum(r.orderQty, 0) + " pcs"]
    ];
    var note = r.type === "MR"
      ? "Material Request: quantities to be issued from warehouse stock for the production order above."
      : "Purchase Request: quantities to be purchased (stock shortage or non-stock item). Codes are the Accurate item codes.";
    UI.printHTML(UI.docShell(r.type === "MR" ? "MATERIAL REQUEST" : "PURCHASE REQUEST",
      info, requestTableHTML(r), ["Diminta oleh (PPIC)", "Diperiksa oleh (WH/Purchasing)", "Disetujui oleh (Manager)"], note));
  }

  function simTableHTML(rec) {
    var h = "<table class='lines'><tr><th style='width:4%'>No</th><th style='width:4%'>Sec</th><th style='width:11%'>Item Code</th><th>Description</th>" +
      "<th style='width:6%'>Unit</th><th style='width:9%'>Qty/Unit</th><th style='width:9%'>Gross Req</th><th style='width:8%'>On Hand</th>" +
      "<th style='width:8%'>MR Qty</th><th style='width:8%'>PR Qty</th></tr>";
    (rec.lines || []).forEach(function (l, i) {
      h += "<tr><td class='c'>" + (i + 1) + "</td><td class='c'>" + (l.section === "FORMULA" ? "A" : "B") + "</td><td class='c'>" + Engine.esc(l.materialCode) +
        "</td><td>" + Engine.esc(l.name) + "</td><td class='c'>" + Engine.esc(l.unit) + "</td><td class='r'>" + Engine.fmtNum(l.perUnit) +
        "</td><td class='r'>" + Engine.fmtNum(l.gross) + "</td><td class='r'>" + Engine.fmtNum(l.onHand) +
        "</td><td class='r'>" + (l.mrQty ? Engine.fmtNum(l.mrQty) : "-") + "</td><td class='r'>" + (l.prQty ? Engine.fmtNum(l.prQty) : "-") + "</td></tr>";
    });
    return h + "</table>";
  }

  function printSim(rec) {
    var info = [
      ["No Simulasi", rec.noSim], ["Tgl", rec.date],
      ["No FG", rec.fgKode], ["Nama FG", rec.fgName || "-"],
      ["No BOM", rec.noBom || "-"], ["Order Qty", Engine.fmtNum(rec.orderQty, 0) + " pcs"],
      ["Material Request", rec.mrDocNo || "-"], ["Purchase Request", rec.prDocNo || "-"]
    ];
    UI.printHTML(UI.docShell("ORDER SIMULATION - MATERIAL REQUIREMENT PLAN", info, simTableHTML(rec),
      ["Disimulasikan oleh (PPIC)", "Diperiksa oleh (Purchasing)", "Disetujui oleh (Manager)"],
      "Quick projection of material requirements from an incoming order. MR = issue from warehouse, PR = purchase (shortage or non-stock)."));
  }

  /* ---------------- Audit log ---------------- */
  function audit(root) {
    var db = Store.get();
    var q = "";
    var bodyWrap = UI.el("div");
    var search = UI.input({ placeholder: "Filter audit trail..." });
    search.addEventListener("input", function () { q = search.value.toLowerCase(); draw(); });
    root.appendChild(UI.pageHead("Audit Log",
      "Every create / update / delete / import is logged with the WIB timestamp and the acting user, mirroring columns H and I of the Google Sheet.", [search]));
    function draw() {
      UI.clear(bodyWrap);
      var rows = db.audit.filter(function (a) {
        if (!q) return true;
        return (a.ts + " " + a.user + " " + a.action + " " + a.entity + " " + a.detail).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Waktu (WIB)", cls: "mono", key: "ts" },
        { label: "User", key: "user" },
        { label: "Role", render: function (r) { return UI.tag(r.role || "-"); } },
        { label: "Action", render: function (r) { return UI.tag(r.action); } },
        { label: "Entity", key: "entity" },
        { label: "Detail", key: "detail" }
      ], rows, { emptyText: "No audit entries." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
  }

  /* ---------------- Settings & data ---------------- */
  function settings(root) {
    var db = Store.get();
    var cloud = window.Sync && Sync.enabled();
    /* Admin-only page in cloud mode (also gated in the nav and router):
       acting user, warning parameters, backups and data reset must never
       render for other signed-in roles. Offline mode has no accounts, so the
       page stays reachable there. */
    if (cloud && (db.meta.user || {}).role !== "Admin") {
      root.appendChild(UI.pageHead("Settings & Data", "This page is only available to the Admin role.", []));
      root.appendChild(UI.card("Restricted", null,
        UI.el("p", { class: "muted", text: "Ask an Admin to change the acting user, parameters, backups or data reset." })));
      return;
    }
    root.appendChild(UI.pageHead("Settings & Data",
      cloud
        ? "Signed-in staff account, warning parameters and data management. Supabase is the system of record; this browser keeps a fast working copy."
        : "Acting user (used in the audit trail and document footers), warning parameters and data management. All data lives in this browser's local storage - export a backup regularly.", []));

    if (cloud) {
      var p = Sync.getProfile();
      var acc = (window.SB && SB.me()) || {};
      root.appendChild(UI.card("Cloud database (Supabase)", [
        UI.btn("Sync now", function () { Sync.flush(); UI.toast("Sync started", "ok"); }, "btn-primary"),
        UI.btn("Sign out", function () {
          Sync.signOut().then(function () { location.reload(); });
        }, "btn-danger")
      ], UI.el("div", { class: "kv" }, [
        UI.el("div", { text: "Status" }), UI.el("div", { text: Sync.getStatus() }),
        UI.el("div", { text: "Account" }), UI.el("div", { text: acc.email || "-" }),
        UI.el("div", { text: "Role" }), UI.el("div", { text: p ? p.role : "-" }),
        UI.el("div", { text: "Queued changes" }), UI.el("div", { text: String(Sync.pendingCount()) })
      ])));
    }

    var iName = UI.input({ value: db.meta.user.name });
    var iEmail = UI.input({ value: db.meta.user.email });
    var iRole = UI.select(ViewsMaster.ROLES.map(function (r) { return [r, r]; }), db.meta.user.role);
    /* Role management belongs to Admin: in cloud mode an editable select
       here would let any signed-in user self-assign a higher role (the
       value is synced to their cloud profile on save). */
    var roleLocked = !!cloud && db.meta.user.role !== "Admin";
    if (roleLocked) { iRole.disabled = true; iRole.title = "Only Admin can change roles"; }
    var iWarn = UI.input({ type: "number", step: "1", min: "1", value: String(db.meta.expWarnDays || 90) });
    root.appendChild(UI.card("Acting user & parameters", [
      UI.btn("Save settings", function () {
        db.meta.user = { name: iName.value.trim() || "User", email: iEmail.value.trim(), role: iRole.value };
        db.meta.expWarnDays = Number(iWarn.value) || 90;
        Store.audit("UPDATE", "Settings", "user " + db.meta.user.name + " (" + db.meta.user.role + "), NA warning " + db.meta.expWarnDays + " days");
        Store.save();
        if (window.Sync && Sync.enabled()) {
          var me = window.SB && SB.me();
          if (me && me.uid) {
            SB.upsert("profiles", [{
              id: me.uid,
              full_name: db.meta.user.name,
              role: db.meta.user.role,
              email: db.meta.user.email || me.email
            }]).then(function () {
              var pr = Sync.getProfile();
              if (pr) { pr.full_name = db.meta.user.name; pr.role = db.meta.user.role; }
            }).catch(function () {});
          }
        }
        App.updateUserChip();
        UI.toast("Settings saved", "ok");
      }, "btn-primary")
    ], UI.el("div", { class: "form-grid" }, [
      UI.field("Name", iName),
      UI.field("Email", iEmail),
      UI.field("Role", iRole, roleLocked ? "Only Admin can change roles." : "The role labels audit entries and controls which master-data fields you can edit."),
      UI.field("NA expiry warning window (days)", iWarn)
    ])));

    root.appendChild(UI.card("Data management", null, UI.el("div", { class: "btn-row" }, [
      UI.btn("Export backup (JSON)", function () { Store.exportJSON(); }),
      UI.btn("Import backup (JSON)", function () {
        ViewsMaster.pickFile(function (txt) {
          try { Store.importJSON(txt); UI.toast("Backup restored", "ok"); App.refresh(); }
          catch (e) { UI.toast("Import failed: " + e.message, "err"); }
        });
      }),
      UI.btn("Export Master F/G CSV", function () { Store.exportMasterCSV(); }),
      UI.btn("Reset to sample data", function () {
        UI.confirmDialog("Replace ALL current data with the sample dataset?", function () {
          Store.resetToSample(); UI.toast("Sample data restored", "ok"); App.refresh();
        });
      }, "btn-danger")
    ])));

    /* Demo pipeline (Admin-only): builds a fully-linked sample chain up to an
       APPROVED packing work order so the FG receipt (FR-PR-02) and the Surat
       Jalan can be raised live. The whole chain signs off every department's
       state machine, so only Admin may load it. */
    if ((db.meta.user || {}).role === "Admin") {
      root.appendChild(UI.card("Demo pipeline (end-to-end sample)", null, UI.el("div", {}, [
        UI.el("p", { class: "muted", style: "margin:0 0 10px;font-size:12.8px;line-height:1.6",
          text: "Builds a fully-linked sample chain on top of the current data: a Master Customer, three Master Suppliers (with the raw & related materials linked to them), a Confirmed Sales Order, PPIC netting (PR + call-off + campaign), Purchase Orders, received & QA-released lots, staging, line clearances, bulk mixing, a BTIP transfer, packing and an APPROVED release (FR-QC-06). It stops at the approved packing WO so you can raise the FG receipt and the Surat Jalan live." }),
        UI.el("div", { class: "btn-row" }, [
          UI.btn("Load demo pipeline", function () {
            UI.confirmDialog("Load the demo pipeline? This adds sample master data and documents to the current dataset.", function () {
              try {
                var res = DemoSeed.build();
                UI.toast(res.message || "Demo pipeline loaded", res.alreadyLoaded ? "err" : "ok");
                App.refresh();
              } catch (e) { UI.toast("Demo build failed: " + e.message, "err"); }
            }, "Load demo");
          }, "btn-primary")
        ])
      ])));
    }

    root.appendChild(UI.card("Business rules implemented (v1)", null, UI.el("div", { style: "font-size:12.8px;line-height:1.7" }, [
      UI.el("ul", { style: "margin:0;padding-left:18px" }, [
        UI.el("li", { html: "<b>Kode Produk F/G (col A)</b> = FFS Formula + '-' + FPS Kemas (fallback to whichever exists)." }),
        UI.el("li", { html: "<b>Status F/G (col C)</b>: Discontinue flag &rarr; Non Aktif; missing FFS or FPS &rarr; Non Aktif; missing Kode NA &rarr; Pending BPOM; expired Tgl Expire NA &rarr; Non Aktif; otherwise Aktif." }),
        UI.el("li", { html: "<b>Audit</b>: every change stores user + WIB timestamp (GMT+7), like columns H and I." }),
        UI.el("li", { html: "<b>BOM</b>: complete material list - section A formula (bulk) raw materials per batch, section B kemas components per piece, with loss %, supported-by and Accurate item codes." }),
        UI.el("li", { html: "<b>Simulation</b>: gross = qty/unit x order qty x (1+loss%). Stocked items: on-hand part &rarr; Material Request, shortage &rarr; Purchase Request. Non-stock items: fully Purchase Request." }),
        UI.el("li", { html: "<b>Next pass (v2)</b>: internal SO from Marketing, Proforma Invoice / Invoice for finance with Accurate code export." })
      ])
    ])));
  }

  return { sim: sim, requests: requests, audit: audit, settings: settings, printRequest: printRequest };
})();
