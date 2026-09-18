/* ============================================================
   VIEWS - Dashboard, Master F/G, Master Material
   ============================================================ */
window.ViewsMaster = (function () {

  var CAT_LABEL = { RM: "Raw Material (Formula)", PM: "Packaging (Kemas)", AX: "Auxiliary" };
  var ROLES = ["RND Formula", "RND Kemas", "Regulatory", "Marketing", "PPIC", "Finance", "QA"];

  /* Master F/G write access belongs to RND Formula, RND Kemas and
     Regulatory only. Marketing (SO), Finance (copy SKU codes), PPIC and
     QA (BMR / picking) consume the list read-only. */
  var FG_EDITOR_ROLES = ["RND Formula", "RND Kemas", "Regulatory"];
  /* Field ownership inside the editor - who may input/edit which column:
     RND Formula -> FFS code + Deskripsi + Discontinue
     RND Kemas   -> FPS code + Deskripsi + Discontinue
     Regulatory  -> FFS code + Deskripsi + Kode NA + Tgl Expire NA + Discontinue */
  var FG_FIELD_RIGHTS = {
    "RND Formula": { ffs: true, fps: false, desc: true, na: false, exp: false, disc: true },
    "RND Kemas":   { ffs: false, fps: true, desc: true, na: false, exp: false, disc: true },
    "Regulatory":  { ffs: true, fps: false, desc: true, na: true, exp: true, disc: true }
  };
  function canEditFG() {
    var u = Store.get().meta.user || {};
    return FG_EDITOR_ROLES.indexOf(u.role) >= 0;
  }

  /* ---------------- Dashboard ---------------- */
  var STATUS_COLORS = { "Aktif": "#9fe8c7", "Pending BPOM": "#ffd98a", "Non Aktif": "#ffc2c6" };
    var FACET_SVG = "<svg class='hero-facet' viewBox='0 0 100 90' aria-hidden='true'>" +
      "<polygon points='50,2 38,30 62,30' fill='#ffdade'/>" +
      "<polygon points='38,30 26,58 50,58' fill='#f2767c'/>" +
      "<polygon points='62,30 50,58 74,58' fill='#e04b52'/>" +
      "<polygon points='26,58 14,86 38,86' fill='#8f1a1e'/>" +
      "<polygon points='50,58 38,86 62,86' fill='#b12024'/>" +
      "<polygon points='74,58 62,86 86,86' fill='#f2767c'/>" +
      "</svg>";

  function dashboard(root) {
    var db = Store.get();
    var counts = { "Aktif": 0, "Non Aktif": 0, "Pending BPOM": 0 };
    db.fgs.forEach(function (f) { counts[f.status] = (counts[f.status] || 0) + 1; });
    var formulas = {}, kemas = {};
    db.fgs.forEach(function (f) { if (f.ffs) formulas[f.ffs] = 1; if (f.fps) kemas[f.fps] = 1; });
    var total = db.fgs.length;

    /* ----- hero briefing panel ----- */
    var dateLine = new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta"
    }).format(new Date());
    var hero = UI.el("section", { class: "dash-hero" });
    hero.innerHTML =
      "<div class='hero-col'>" +
        "<div class='hero-kicker'>Master List Finish Good &middot; live briefing</div>" +
        "<div class='hero-total'>" + total + "</div>" +
        "<div class='hero-sub'>finish-good SKUs built from <b>" + Object.keys(formulas).length +
          "</b> formula codes and <b>" + Object.keys(kemas).length + "</b> kemas codes, with <b>" +
          db.boms.length + "</b> BOM on file</div>" +
        "<div class='hero-date'>" + Engine.esc(dateLine) + " &middot; " + Engine.nowWIB().slice(11, 16) +
          " WIB &middot; " + Engine.esc(db.meta.user.role) + " on desk</div>" +
      "</div>" +
      "<div class='hero-col donut-wrap'>" + donutSVG(counts, total) +
        "<div class='donut-legend'>" +
          legendRow("Aktif", counts["Aktif"], total) +
          legendRow("Pending BPOM", counts["Pending BPOM"], total) +
          legendRow("Non Aktif", counts["Non Aktif"], total) +
        "</div>" +
      "</div>" +
      "<div class='hero-col hero-status'>" +
        meterRow("Aktif &amp; trade-ready", counts["Aktif"], total, STATUS_COLORS["Aktif"]) +
        meterRow("Waiting BPOM registration", counts["Pending BPOM"], total, STATUS_COLORS["Pending BPOM"]) +
        meterRow("Non aktif / discontinued", counts["Non Aktif"], total, STATUS_COLORS["Non Aktif"]) +
      "</div>" + FACET_SVG;
    root.appendChild(hero);

    /* ----- quick action tiles ----- */
    var tiles = UI.el("div", { class: "dash-tiles" });
    tiles.appendChild(canEditFG()
      ? tile("+", "New F/G SKU", "formula + kemas + regulatory fields", function () { App.go("fg"); })
      : tile("\u2261", "Browse Master F/G", "view the SKU list & copy codes", function () { App.go("fg"); }));
    tiles.appendChild(tile("≡", "Build a BOM", "complete formula & kemas material list", function () { App.go("bom"); }));
    tiles.appendChild(tile("→", "Simulate an order", "explode BOM into MR / PR", function () { App.go("sim"); }));
    root.appendChild(tiles);

    /* ----- row 1: watchlist + production readiness ----- */
    var warn = db.meta.expWarnDays || 90;
    var todayMs = Engine.parseDate(Engine.todayISO()).getTime();
    var watch = db.fgs.filter(function (f) { return f.tglExpire && Engine.parseDate(f.tglExpire); })
      .map(function (f) {
        f._days = Math.floor((Engine.parseDate(f.tglExpire).getTime() - todayMs) / 86400000);
        return f;
      })
      .sort(function (a, b) { return a._days - b._days; })
      .slice(0, 6);
    var watchHTML = watch.length ? watch.map(function (f) {
      var cls = f._days <= 30 ? "crit" : (f._days <= warn ? "warn" : "ok");
      var lab = f._days < 0 ? "EXP" : f._days + "d";
      return "<div class='watch-item'><span class='days-chip " + cls + "'>" + lab + "</span>" +
        "<div class='w-body'><div class='w-kode'>" + Engine.esc(f.kodeFG) + "</div>" +
        "<div class='w-desc'>" + Engine.esc(f.deskripsi) + "</div></div>" +
        "<div class='w-exp'>NA exp " + Engine.esc(f.tglExpire) + "</div></div>";
    }).join("") : "<div class='empty'>No NA registration carries an expiry date yet.</div>";

    var ready = db.boms.map(function (b) {
      var fg = Store.fgById(b.fgId);
      if (!fg) return null;
      var cap = Infinity, constraint = null;
      b.items.forEach(function (it) {
        var m = Store.matMap()[it.materialCode];
        if (!m) return;
        var per = (Number(it.qtyPerUnit) || 0) * (1 + (Number(it.lossPct) || 0) / 100);
        if (per <= 0) return;
        var u = Math.floor((Number(m.stockQty) || 0) / per);
        if (u < cap) { cap = u; constraint = m; }
      });
      return { fg: fg, units: cap === Infinity ? 0 : cap, constraint: constraint };
    }).filter(Boolean);
    var readHTML = ready.length ? ready.map(function (r) {
      var scale = Math.max(1000, r.units);
      var pct = Math.min(100, Math.round(r.units / scale * 100));
      return "<div class='read-row'><div class='read-head'><span class='r-name'>" + Engine.esc(r.fg.deskripsi) +
        "</span><b>&asymp; " + r.units.toLocaleString("en-US") + " pcs</b></div>" +
        "<div class='meter light'><i style='width:" + pct + "%;background:linear-gradient(90deg,var(--accent),var(--rose))'></i></div>" +
        "<div class='constraint'>from current warehouse stock &middot; binding constraint: <b>" +
        Engine.esc(r.constraint ? r.constraint.name : "-") + "</b>" +
        (r.constraint ? " (on hand " + Engine.fmtNum(r.constraint.stockQty) + " " + Engine.esc(r.constraint.unit) + ")" : "") +
        "</div></div>";
    }).join("") : "<div class='empty'>No BOM yet - readiness cannot be projected.</div>";

    var g1 = UI.el("div", { class: "dash-grid" });
    g1.appendChild(panel("BPOM & expiry watchlist", "Every NA registration ordered by urgency - red ≤ 30 days, amber inside the " + warn + "-day window, green beyond", watchHTML));
    g1.appendChild(panel("PPIC readiness", "How many pieces each BOM can build from stock on hand right now", readHTML));
    root.appendChild(g1);

    /* ----- row 2: warehouse alerts + activity feed ----- */
    var zero = db.materials.filter(function (m) { return (Number(m.stockQty) || 0) <= 0; });
    var alertHTML = zero.length ? zero.map(function (m) {
      return "<span class='alert-chip'><i class='dot'></i>" + Engine.esc(m.code) + " &middot; " + Engine.esc(m.name) + "</span>";
    }).join("") : "<div class='ok-note'>Warehouse covers every stocked material - no zero-stock line.</div>";

    var feedHTML = db.audit.length ? "<div class='feed'>" + db.audit.slice(0, 6).map(function (a) {
      return "<div class='feed-item'><div><b>" + Engine.esc(a.action) + "</b> " + Engine.esc(a.entity) +
        " &mdash; " + Engine.esc(a.detail) + "</div>" +
        "<div class='f-meta'>" + Engine.esc(a.ts) + " WIB &middot; " + Engine.esc(a.user) + "</div></div>";
    }).join("") + "</div>" : "<div class='empty'>No activity recorded yet.</div>";

    var g2 = UI.el("div", { class: "dash-grid" });
    g2.appendChild(panel("Warehouse alerts", "Zero-stock items block the next production run", alertHTML));
    g2.appendChild(panel("Activity feed", "Latest changes captured in the audit trail", feedHTML));
    root.appendChild(g2);
  }

  function donutSVG(counts, total) {
    var r = 46, c = 2 * Math.PI * r, acc = 0;
    var segs = ["Aktif", "Pending BPOM", "Non Aktif"].map(function (k) {
      var frac = total ? (counts[k] || 0) / total : 0;
      var s = "<circle r='" + r + "' cx='69' cy='69' fill='none' stroke='" + STATUS_COLORS[k] +
        "' stroke-width='15' stroke-linecap='butt' stroke-dasharray='" + (frac * c).toFixed(2) + " " +
        (c - frac * c).toFixed(2) + "' stroke-dashoffset='" + (-acc * c).toFixed(2) + "'/>";
      acc += frac;
      return s;
    }).join("");
    var pctAktif = total ? Math.round((counts["Aktif"] || 0) / total * 100) : 0;
    return "<div class='donut-box'><svg width='138' height='138' viewBox='0 0 138 138' style='transform:rotate(-90deg)'>" +
      segs + "</svg><div class='donut-center'><b>" + pctAktif + "%</b><span>aktif</span></div></div>";
  }
  function legendRow(label, value, total) {
    var pct = total ? Math.round(value / total * 100) : 0;
    return "<span class='legend-row'><i class='legend-dot' style='background:" + STATUS_COLORS[label] + "'></i>" +
      label + " <b>" + value + "</b> <span class='lg-pct'>" + pct + "%</span></span>";
  }
  function meterRow(label, value, total, color) {
    var pct = total ? Math.round(value / total * 100) : 0;
    return "<div class='hstat'><div class='row'><span>" + label + "</span><b>" + value + " &middot; " + pct + "%</b></div>" +
      "<div class='meter'><i style='width:" + pct + "%;background:" + color + "'></i></div></div>";
  }
  function tile(glyph, label, sub, fn) {
    return UI.el("button", { class: "dash-tile", type: "button", onclick: fn }, [
      UI.el("span", { class: "t-ico", text: glyph }),
      UI.el("span", { class: "t-label", text: label }),
      UI.el("span", { class: "t-sub", text: sub })
    ]);
  }
  function panel(title, sub, innerHTML) {
    return UI.el("section", { class: "panel" }, [
      UI.el("h3", { text: title }),
      UI.el("div", { class: "p-sub", text: sub }),
      UI.el("div", { html: innerHTML })
    ]);
  }

  /* ---------------- Master F/G ---------------- */
  var fgFilter = { q: "", status: "ALL" };

  function fg(root) {
    var db = Store.get();
    var headActions = [UI.btn("Export Sheet CSV", function () { Store.exportMasterCSV(); UI.toast("Master F/G CSV downloaded", "ok"); }, "")];
    if (canEditFG()) headActions.push(UI.btn("+ New F/G SKU", function () { fgEditor(null); }, "btn-primary"));
    root.appendChild(UI.pageHead("Master List Finish Good", "", headActions));

    var search = UI.input({ placeholder: "Search kode, deskripsi, FFS, FPS, NA...", value: fgFilter.q });
    var body = UI.el("div", { class: "card-body tight" });
    search.addEventListener("input", function () { fgFilter.q = search.value; renderFGTable(body); });
    var chips = UI.el("div", { class: "filter-chips" });
    ["ALL", "Aktif", "Pending BPOM", "Non Aktif"].forEach(function (s) {
      chips.appendChild(UI.el("button", {
        class: "chip" + (fgFilter.status === s ? " active" : ""), text: s === "ALL" ? "All status" : s,
        onclick: function () { fgFilter.status = s; App.refresh(); }
      }));
    });
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, chips, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.fgs.length + " SKU" })]));
    card.appendChild(body);
    root.appendChild(card);
    renderFGTable(body);
  }

  function renderFGTable(body) {
    UI.clear(body);
    var db = Store.get();
    var q = fgFilter.q.toLowerCase();
    var rows = db.fgs.filter(function (f) {
      if (fgFilter.status !== "ALL" && f.status !== fgFilter.status) return false;
      if (!q) return true;
      return (f.kodeFG + " " + f.deskripsi + " " + f.ffs + " " + f.fps + " " + f.kodeNA).toLowerCase().indexOf(q) >= 0;
    });
    var cols = [
      { label: "Kode Produk Finish Good", render: function (r) {
        return UI.el("div", { style: "display:flex;gap:6px;align-items:center" }, [
          UI.el("span", { class: "mono", style: "font-weight:700", text: r.kodeFG }),
          UI.btn("copy", function () { UI.copyText(r.kodeFG); }, "btn-ghost btn-sm")
        ]);
      } },
      { label: "Deskripsi Produk", key: "deskripsi" },
      { label: "Status F/G", render: function (r) { return UI.pill(r.status); } },
      { label: "FFS Formula", cls: "mono", key: "ffs" },
      { label: "FPS Kemas", cls: "mono", key: "fps" },
      { label: "Kode NA", cls: "mono", render: function (r) { return r.kodeNA || "<span class='row-muted'>-</span>"; } },
      { label: "Tgl Expire NA", cls: "mono", render: function (r) { return r.tglExpire || "<span class='row-muted'>-</span>"; } },
      { label: "Discontinue", render: function (r) { return r.discontinue ? UI.tag("YES") : "<span class='row-muted'>-</span>"; } },
      { label: "Diubah Oleh / Waktu", render: function (r) {
        return UI.el("div", { style: "font-size:11px;color:var(--muted)" }, [
          UI.el("div", { text: r.diubahOleh || "-" }),
          UI.el("div", { class: "mono", text: r.waktuUpdate || "-" })
        ]);
      } }
    ];
    if (canEditFG()) cols.push({ label: "", render: function (r) {
        return UI.el("div", { class: "btn-row" }, [
          UI.btn("Edit", function () { fgEditor(r); }, "btn-sm"),
          UI.btn("Revision", function () { fgRevision(r); }, "btn-sm"),
          UI.btn("Delete", function () {
            UI.confirmDialog("Delete F/G " + r.kodeFG + "? BOMs referencing it will keep a dangling reference.", function () {
              Store.deleteFG(r.id); App.refresh();
            });
          }, "btn-danger btn-sm")
        ]);
      } });
    body.appendChild(UI.table(cols, rows, { emptyText: "No F/G matches the current filter." }));
  }

  function fgEditor(rec) {
    if (!canEditFG()) {
      UI.toast("Master F/G is read-only for " + (Store.get().meta.user || {}).role, "err");
      return;
    }
    var isNew = !rec;
    var d = Object.assign({ ffs: "", fps: "", deskripsi: "", kodeNA: "", tglExpire: "", discontinue: false }, rec || {});

    var pvKode = UI.el("span", { class: "pv-kode", text: "-" });
    var pvStatus = UI.el("span");
    function preview() {
      pvKode.textContent = Engine.kodeFG(d.ffs, d.fps) || "(empty)";
      UI.clear(pvStatus);
      pvStatus.appendChild(UI.pill(Engine.evaluateStatus(d.ffs, d.fps, d.kodeNA, d.tglExpire, d.discontinue)));
    }

    var iFfs = UI.input({ class: "input mono", value: d.ffs, placeholder: "e.g. TO01MR03" });
    var iFps = UI.input({ class: "input mono", value: d.fps, placeholder: "e.g. 100200100" });
    var iDesc = UI.input({ value: d.deskripsi, placeholder: "Brand + product + size" });
    var iNa = UI.input({ class: "input mono", value: d.kodeNA, placeholder: "NA1826..." });
    var iExp = UI.input({ type: "date", value: d.tglExpire || "" });
    [iFfs, iFps, iDesc, iNa, iExp].forEach(function (n) {
      n.addEventListener("input", function () {
        d.ffs = iFfs.value.trim(); d.fps = iFps.value.trim(); d.deskripsi = iDesc.value.trim();
        d.kodeNA = iNa.value.trim(); d.tglExpire = iExp.value;
        preview();
      });
    });
    var disc = UI.checkRow("Discontinue / superseded revision (forces status Non Aktif)", d.discontinue, function (v) { d.discontinue = v; preview(); });

    /* Field-level rights: fields this role does not own become read-only
       (grey styling) with a tooltip naming the owning department; the
       Discontinue checkbox is disabled instead (readonly n/a to boxes). */
    var role = (Store.get().meta.user || {}).role;
    var rights = FG_FIELD_RIGHTS[role] || { ffs: true, fps: true, desc: true, na: true, exp: true, disc: true };
    function lockField(inp, editable, who) {
      if (!editable) {
        inp.readOnly = true;
        inp.title = "Locked for " + role + " - " + who;
      }
    }
    lockField(iFfs, rights.ffs, "RND Formula / Regulatory own the formula code");
    lockField(iFps, rights.fps, "RND Kemas owns the kemas code");
    lockField(iDesc, rights.desc, "owned by the master-data roles");
    lockField(iNa, rights.na, "Regulatory owns Kode NA");
    lockField(iExp, rights.exp, "Regulatory owns the NA expiry date");
    var discCb = disc.querySelector("input");
    if (discCb && !rights.disc) { discCb.disabled = true; discCb.title = "Locked for " + role; }
    function lk(editable) { return editable ? "" : " Locked for your role."; }

    var body = UI.el("div", {}, [
      UI.el("div", { class: "preview-box" }, [
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "Kode Produk F/G (auto)" }), pvKode]),
        UI.el("div", {}, [UI.el("div", { class: "pv-label", text: "Status F/G (auto)" }), pvStatus])
      ]),
      fieldset("RND Formula", [UI.field("FFS Formula code", iFfs, "Initial formula code input by RND formula team; corrected after BPOM approval." + lk(rights.ffs))]),
      fieldset("RND Kemas", [UI.field("FPS Kemas code", iFps, "Packaging code input by RND Kemas team." + lk(rights.fps))]),
      fieldset("Regulatory", [
        UI.field("Deskripsi Produk", iDesc, rights.desc ? null : "Locked for your role."),
        UI.el("div", { class: "form-grid" }, [
          UI.field("Kode NA (BPOM)", iNa, (rights.na ? "Leave empty while registration is in progress -> status Pending BPOM." : "") + lk(rights.na)),
          UI.field("Tgl Expire NA", iExp, (rights.exp ? "Passed date -> status flips to Non Aktif on next refresh." : "") + lk(rights.exp))
        ])
      ]),
      disc
    ]);
    preview();

    UI.modal({
      title: isNew ? "New Finish Good SKU" : "Edit Finish Good - " + rec.kodeFG,
      body: body,
      wide: true,
      actions: [{
        label: "Save SKU", cls: "btn-primary", onClick: function () {
          if (!d.ffs && !d.fps) { UI.toast("FFS Formula or FPS Kemas is required", "err"); return; }
          var id = d.ffs + "|" + d.fps;
          if (isNew && Store.fgById(id)) { UI.toast("SKU already exists: " + Engine.kodeFG(d.ffs, d.fps), "err"); return; }
          if (!isNew && id !== rec.id && Store.fgById(id)) { UI.toast("Another SKU already uses " + Engine.kodeFG(d.ffs, d.fps), "err"); return; }
          d.id = id;
          Store.saveFG(d, isNew, rec ? rec.id : null);
          UI.closeModal();
          UI.toast("Saved " + Engine.kodeFG(d.ffs, d.fps) + " - status " + d.status, "ok");
          App.refresh();
        }
      }]
    });
  }
  function fieldset(legend, kids) {
    return UI.el("fieldset", { class: "role-group" }, [UI.el("legend", { text: legend })].concat(kids));
  }

  /* ---------------- Revision workflow ----------------
     Formula / kemas code revised for the same product: instead of the
     user re-typing a whole new SKU, one dialog supersedes the old row
     (auto Discontinue -> Non Aktif) and creates the new revision with
     Kode NA / Tgl Expire NA cleared (BPOM recertification) -> Pending BPOM. */
  function fgRevision(rec) {
    var role = (Store.get().meta.user || {}).role;
    var rights = FG_FIELD_RIGHTS[role] || { ffs: true, fps: true };
    var iFfs = UI.input({ class: "input mono", value: rec.ffs, placeholder: "e.g. TO01MR03" });
    var iFps = UI.input({ class: "input mono", value: rec.fps, placeholder: "e.g. 100200100" });
    if (!rights.ffs) { iFfs.readOnly = true; iFfs.title = "Locked for " + role; }
    if (!rights.fps) { iFps.readOnly = true; iFps.title = "Locked for " + role; }
    var body = UI.el("div", {}, [
      UI.el("div", { class: "preview-box", style: "margin-bottom:12px" }, [
        UI.el("div", { style: "font-size:12.5px;line-height:1.7" }, [
          UI.el("div", { html: "Current SKU <span class='mono' style='font-weight:700'>" + Engine.esc(rec.kodeFG) +
            "</span> will be marked <b>Discontinue</b> (status Non Aktif) as superseded." }),
          UI.el("div", { html: "The new revision keeps the same Deskripsi Produk but starts <b>without Kode NA and Tgl Expire NA</b> (BPOM recertification required) &rarr; status Pending BPOM." }),
          UI.el("div", { html: "BOMs referencing the old SKU keep their reference; build a new BOM for the revision when ready." })
        ])
      ]),
      UI.el("div", { class: "form-grid" }, [
        UI.field("New FFS Formula code", iFfs, rights.ffs ? "Change this when the formula (bulk) is revised." : "Locked for your role."),
        UI.field("New FPS Kemas code", iFps, rights.fps ? "Change this when the packaging is revised." : "Locked for your role.")
      ])
    ]);
    UI.modal({
      title: "New revision - " + rec.kodeFG,
      body: body,
      actions: [{
        label: "Create revision", cls: "btn-primary", onClick: function () {
          var ffs = iFfs.value.trim(), fps = iFps.value.trim();
          if (!ffs && !fps) { UI.toast("FFS Formula or FPS Kemas is required", "err"); return; }
          if (ffs === rec.ffs && fps === rec.fps) { UI.toast("Change at least one code to create a revision", "err"); return; }
          var id = ffs + "|" + fps;
          if (Store.fgById(id)) { UI.toast("SKU already exists: " + Engine.kodeFG(ffs, fps), "err"); return; }
          UI.closeModal();
          var nu = Store.reviseFG(rec.id, ffs, fps);
          if (nu) {
            UI.toast("Revision " + nu.kodeFG + " created - " + rec.kodeFG + " discontinued (Pending BPOM until recertified)", "ok");
            App.refresh();
          }
        }
      }]
    });
  }

  /* ---------------- Master Material ---------------- */
  var matFilter = { q: "", cat: "ALL" };

  function materials(root) {
    var db = Store.get();
    root.appendChild(UI.pageHead("Master Material",
      "All items used by BOMs: formula raw materials (bulk), packaging components (kemas) and auxiliary. On-hand stock drives the Material Request vs Purchase Request split in the order simulation.",
      [UI.btn("+ New Material", function () { matEditor(null); }, "btn-primary")]));

    var search = UI.input({ placeholder: "Search item code / description...", value: matFilter.q });
    search.addEventListener("input", function () { matFilter.q = search.value; draw(); });
    var chips = UI.el("div", { class: "filter-chips" });
    [["ALL", "All"], ["RM", "Formula (RM)"], ["PM", "Kemas (PM)"], ["AX", "Auxiliary"]].forEach(function (c) {
      chips.appendChild(UI.el("button", {
        class: "chip" + (matFilter.cat === c[0] ? " active" : ""), text: c[1],
        onclick: function () { matFilter.cat = c[0]; App.refresh(); }
      }));
    });

    var bodyWrap = UI.el("div");
    function draw() {
      UI.clear(bodyWrap);
      var q = matFilter.q.toLowerCase();
      var rows = db.materials.filter(function (m) {
        if (matFilter.cat !== "ALL" && m.category !== matFilter.cat) return false;
        if (!q) return true;
        return (m.code + " " + m.name + " " + (m.supplier || "")).toLowerCase().indexOf(q) >= 0;
      });
      bodyWrap.appendChild(UI.table([
        { label: "Item Code", cls: "mono", render: function (r) { return "<b>" + Engine.esc(r.code) + "</b>"; } },
        { label: "Description", key: "name" },
        { label: "Category", render: function (r) { return UI.tag(CAT_LABEL[r.category] || r.category); } },
        { label: "Unit", key: "unit" },
        { label: "On Hand", cls: "num", render: function (r) {
          var v = Number(r.stockQty) || 0;
          return v <= 0 ? "<b style='color:var(--red)'>" + Engine.fmtNum(v) + "</b>" : Engine.fmtNum(v);
        } },
        { label: "Stocked", render: function (r) { return r.stocked ? UI.tag("Stocked") : UI.tag("Non-stock / direct buy"); } },
        { label: "Supplier", render: function (r) { return r.supplier || "<span class='row-muted'>-</span>"; } },
        { label: "", render: function (r) {
          return UI.el("div", { class: "btn-row" }, [
            UI.btn("Edit", function () { matEditor(r); }, "btn-sm"),
            UI.btn("Delete", function () {
              UI.confirmDialog("Delete material " + r.code + "?", function () {
                if (!Store.deleteMaterial(r.code)) UI.toast("Material is used in a BOM - cannot delete", "err");
                else App.refresh();
              });
            }, "btn-danger btn-sm")
          ]);
        } }
      ], rows, { emptyText: "No material matches the filter." }));
    }
    var card = UI.el("section", { class: "card" });
    card.appendChild(UI.el("div", { class: "toolbar" }, [search, chips, UI.el("div", { class: "spacer" }),
      UI.el("span", { class: "hint", style: "font-size:11.5px;color:var(--muted)", text: db.materials.length + " items" })]));
    card.appendChild(UI.el("div", { class: "card-body tight" }, [bodyWrap]));
    root.appendChild(card);
    draw();
  }

  function matEditor(rec) {
    var isNew = !rec;
    var d = Object.assign({ code: "", name: "", category: "RM", unit: "pcs", stockQty: 0, stocked: true, supplier: "" }, rec || {});
    var iCode = UI.input({ class: "input mono", value: d.code, placeholder: "e.g. 30200001" });
    var iName = UI.input({ value: d.name });
    var iCat = UI.select([["RM", CAT_LABEL.RM], ["PM", CAT_LABEL.PM], ["AX", CAT_LABEL.AX]], d.category);
    var iUnit = UI.input({ value: d.unit });
    var iStock = UI.input({ type: "number", step: "0.0001", value: String(d.stockQty) });
    var iSup = UI.input({ value: d.supplier, placeholder: "Astoria / Customer / vendor name" });
    var body = UI.el("div", {}, [
      UI.el("div", { class: "form-grid" }, [
        UI.field("Item Code", iCode),
        UI.field("Category", iCat),
        UI.field("Description", iName),
        UI.field("Unit", iUnit),
        UI.field("On-hand stock", iStock),
        UI.field("Supplier / source", iSup)
      ]),
      UI.checkRow("Stocked item (warehouse keeps stock; shortages become Purchase Request)", d.stocked, function (v) { d.stocked = v; })
    ]);
    UI.modal({
      title: isNew ? "New Material" : "Edit Material - " + rec.code,
      body: body,
      actions: [{
        label: "Save Material", cls: "btn-primary", onClick: function () {
          d.code = iCode.value.trim(); d.name = iName.value.trim();
          d.category = iCat.value; d.unit = iUnit.value.trim() || "pcs";
          d.stockQty = Number(iStock.value) || 0; d.supplier = iSup.value.trim();
          if (!d.code || !d.name) { UI.toast("Item code and description are required", "err"); return; }
          if (isNew && Store.matMap()[d.code]) { UI.toast("Item code already exists", "err"); return; }
          if (!isNew && d.code !== rec.code && Store.matMap()[d.code]) { UI.toast("Item code already exists", "err"); return; }
          Store.saveMaterial(d, isNew, rec ? rec.code : null);
          UI.closeModal(); App.refresh();
          UI.toast("Material " + d.code + " saved", "ok");
        }
      }]
    });
  }

  function pickFile(cb) {
    var inp = UI.el("input", { type: "file", accept: ".csv,text/csv,.json,application/json", style: "display:none" });
    document.body.appendChild(inp);
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) UI.readFile(inp.files[0], function (txt) { inp.remove(); cb(txt); });
    });
    inp.click();
  }

  return { dashboard: dashboard, fg: fg, materials: materials, CAT_LABEL: CAT_LABEL, ROLES: ROLES, pickFile: pickFile };
})();
